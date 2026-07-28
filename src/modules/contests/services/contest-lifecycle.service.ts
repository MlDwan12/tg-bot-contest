import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import {
  CONTEST_PARTICIPATE_REPOSITORY,
  CONTEST_REPOSITORY,
} from 'src/common/constants';
import type {
  IContestParticipationRepository,
  IContestRepository,
} from '../interfaces';
import { ContestWithRelations } from '../types';
import { ContestStatus, WinnerStrategy } from 'src/common/enums/contest';
import { ContestJobsService } from './contest-jobs.service';
import { ContestWinnerService } from './contest-winner.service';
import { ContestWinnerNotifyService } from './contest-winner-notify.service';
import { ContestSubscriptionRecheckService } from './contest-subscription-recheck.service';
import { ContestPublicationService } from './contest-publication.service';
import { TelegramService } from 'src/modules/bot/bot.service';
import { getAdminTelegramIdsFromEnv } from 'src/common/helpers/admin-ids.helper';

const WINNER_SELECTION_GRACE_PERIOD_MS = 2 * 60 * 60 * 1000;

@Injectable()
export class ContestLifecycleService {
  constructor(
    @Inject(CONTEST_REPOSITORY)
    private readonly contestRepo: IContestRepository,

    @Inject(CONTEST_PARTICIPATE_REPOSITORY)
    private readonly contestParticipationRepo: IContestParticipationRepository,

    @InjectQueue('contest-publication')
    private readonly publicationQueue: Queue,

    private readonly contestJobsService: ContestJobsService,
    private readonly contestWinnerService: ContestWinnerService,
    private readonly contestWinnerNotifyService: ContestWinnerNotifyService,
    private readonly contestSubscriptionRecheckService: ContestSubscriptionRecheckService,
    private readonly contestPublicationService: ContestPublicationService,
    private readonly logger: Logger,
    private readonly dataSource: DataSource,

    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  async activateContestIfDue(contestId: number): Promise<void> {
    const contest = await this.contestRepo.findByParams({ id: contestId });
    if (!contest) return;

    if (contest.status !== ContestStatus.PENDING) return;

    const now = new Date();
    if (contest.startDate > now) return;

    await this.contestRepo.updateStatusIfCurrent(
      contestId,
      ContestStatus.PENDING,
      ContestStatus.ACTIVE,
    );
  }

  async isContestCompleted(contestId: number): Promise<boolean> {
    const contest = await this.contestRepo.findByParams({ id: contestId });
    return !!contest && contest.status === ContestStatus.COMPLETED;
  }

  async finishContestIdempotent(contestId: number): Promise<void> {
    // PostgreSQL Advisory Lock гарантирует, что при параллельном запуске
    // (BullMQ retry, два воркера) только один процесс выполняет тело функции
    // для данного contestId. Остальные сразу получают acquired=false и выходят.
    //
    // Почему это важно: resolveAndSaveWinners делает случайный розыгрыш.
    // Если два процесса запустят его одновременно — будет два разных розыгрыша,
    // и победители окажутся непредсказуемыми (последний перезапишет первого).
    //
    // pg_try_advisory_lock — non-blocking: не ждёт, сразу возвращает boolean.
    // Лок session-level: удерживается до pg_advisory_unlock или закрытия соединения.
    const [{ acquired }] = await this.dataSource.query<[{ acquired: boolean }]>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [contestId],
    );

    if (!acquired) {
      this.logger.warn(
        { contestId },
        'finishContestIdempotent: лок уже удерживается другим процессом, пропускаем',
      );
      return;
    }

    try {
      const contest = await this.contestRepo.findByIdWithRelations(contestId);
      if (!contest) return;

      if (contest.status === ContestStatus.COMPLETED) return;

      const now = new Date();
      if (contest.endDate > now) return;

      // Перепроверка подписок — отдельная фаза: она делает запрос в Telegram на
      // каждого участника и идёт минутами, а мы держим advisory lock. Ставим
      // джоб и выходим; он по завершении снова позовёт finishContest, и мы
      // придём сюда уже с проставленными статусами.
      if (this.contestSubscriptionRecheckService.needsRecheck(contest)) {
        this.logger.log(
          { contestId },
          'finishContestIdempotent: нужна перепроверка подписок, откладываем завершение',
        );
        await this.contestJobsService.scheduleSubscriptionRecheck(contestId);
        return;
      }

      // Пул — только прошедшие перепроверку. Отписавшиеся после участия в
      // розыгрыш не идут и не учитываются при сверке с числом призовых мест.
      const participants =
        await this.contestParticipationRepo.findEligibleByContestId(contest.id);
      const hasParticipants = participants.length > 0;

      if (hasParticipants) {
        if (contest.winnerStrategy === WinnerStrategy.MANUAL) {
          const existingWinners =
            await this.contestWinnerService.getContestWinners(contest.id);

          if (existingWinners.length === 0) {
            // Победители вручную ещё не выбраны — не завершаем, а даём админу
            // grace-период их выбрать (сдвиг дедлайна + перепланирование +
            // уведомление на каждой попытке, чтобы админ не забыл).
            await this.scheduleFinishGracePeriod(
              contest,
              'finishContestIdempotent: MANUAL-стратегия без выбранного победителя, откладываем завершение',
              'для него не выбраны победители (стратегия: вручную).',
              'Пожалуйста, назначьте победителей в панели администратора до этого времени.',
            );
            return;
          }

          await this.contestWinnerService.resolveAndSaveWinners(contest);
        } else {
          // Автоматический розыгрыш требует уникальных участников не меньше числа
          // призовых мест — иначе resolveAndSaveWinners бросит ошибку, finish-job
          // окончательно упадёт и конкурс навсегда зависнет в ACTIVE. Вместо клина
          // даём тот же grace-период, что и MANUAL: зовём админа уменьшить число
          // мест (либо за это время подтянутся ещё участники — конкурс всё ещё
          // ACTIVE). Считаем уникальных так же, как сам розыгрыш: по user.id.
          const uniqueParticipantCount = new Set(
            participants
              .map((p) => p.user?.id)
              .filter((id): id is number => id != null),
          ).size;

          if (uniqueParticipantCount < contest.prizePlaces) {
            await this.scheduleFinishGracePeriod(
              contest,
              'finishContestIdempotent: участников меньше числа призовых мест, откладываем завершение',
              `участников (${uniqueParticipantCount}) меньше числа призовых мест (${contest.prizePlaces}).`,
              'Пожалуйста, уменьшите число призовых мест в панели администратора до этого времени.',
            );
            return;
          }

          await this.contestWinnerService.resolveAndSaveWinners(contest);
        }
      }

      const changed =
        await this.contestRepo.updateStatusIfNotCompleted(contestId);
      if (!changed) return;

      const publicationIds =
        await this.contestPublicationService.getPublishedPublicationIdsForContest(
          contestId,
        );

      this.logger.log(
        { contestId, hasParticipants, publicationIds },
        'finishContestIdempotent: publications for finished button update',
      );

      for (const publicationId of publicationIds) {
        await this.publicationQueue.add(
          'updateFinishedButton',
          { publicationId, hasParticipants },
          { jobId: `publication:${publicationId}:finish-button` },
        );
      }

      await this.notifyWinners(contestId);
    } finally {
      // Освобождаем лок при любом исходе — в том числе при исключении.
      // Без finally: если resolveAndSaveWinners выбросит ошибку, лок
      // останется висеть до закрытия соединения (может быть долго).
      await this.dataSource.query('SELECT pg_advisory_unlock($1)', [contestId]);
    }
  }

  async completeContest(contestId: number): Promise<ContestWithRelations> {
    const contest = await this.contestRepo.findByIdWithRelations(contestId);

    if (!contest) {
      throw new NotFoundException('Конкурс не найден');
    }

    if (contest.status === ContestStatus.COMPLETED) {
      throw new BadRequestException('Конкурс уже завершён');
    }

    if (contest.status === ContestStatus.CANCELLED) {
      throw new BadRequestException('Нельзя завершить отменённый конкурс');
    }

    if (contest.status === ContestStatus.PENDING) {
      throw new BadRequestException('Нельзя завершить конкурс до его старта');
    }

    // Пустой конкурс завершается успешно, без победителей — как автозавершение
    // (finishContestIdempotent). «Нет победителей» тут валидный исход, не ошибка.
    // participants уже загружены findByIdWithRelations — без лишнего запроса.
    const hasParticipants = (contest.participants?.length ?? 0) > 0;

    // F1: атомарные ворота против гонки завершения (двойной клик по «Завершить»).
    // updateStatusIfNotCompleted делает ACTIVE→COMPLETED одним атомарным
    // UPDATE ... WHERE status != COMPLETED. При двух одновременных завершениях
    // ровно ОДИН получит affected=1 (claimed=true) и разыграет победителя;
    // проигравший гонку получит false и выйдет БЕЗ повторного розыгрыша.
    // Раньше оба проходили reuse-guard (existingWinners=0, read-then-write без
    // блокировки) до записи и разыгрывали дважды — это и была residual race F1.
    const claimed = await this.contestRepo.updateStatusIfNotCompleted(
      contest.id,
    );
    if (!claimed) {
      throw new BadRequestException('Конкурс уже завершён');
    }

    if (hasParticipants) {
      try {
        await this.contestWinnerService.resolveAndSaveWinners(contest);
      } catch (err) {
        // Розыгрыш не удался (MANUAL без заранее выбранных победителей,
        // участников меньше призовых мест и т.п.): откатываем ворота из
        // COMPLETED обратно в прежний статус, чтобы конкурс не завис
        // завершённым без победителей и завершение можно было повторить.
        await this.contestRepo.updateStatusIfCurrent(
          contest.id,
          ContestStatus.COMPLETED,
          contest.status,
        );
        throw err;
      }
    }

    // Статус уже COMPLETED (ворота выше) — здесь только текст кнопки.
    await this.contestRepo.update(contest.id, {
      buttonText: 'Конкурс завершён',
    });

    const updatedContest = await this.contestRepo.findByIdWithRelations(
      contest.id,
    );

    if (!updatedContest) {
      throw new NotFoundException('Конкурс не найден после завершения');
    }

    await this.contestPublicationService.syncPublishedPosts(updatedContest);

    await this.notifyWinners(contest.id);

    return updatedContest;
  }

  /**
   * Ставит личные уведомления победителям. Ошибку глушим намеренно: конкурс уже
   * завершён и итоги опубликованы — падение постановки уведомлений не должно
   * откатывать или ронять завершение. Неотправленное видно в bot_messages.
   */
  private async notifyWinners(contestId: number): Promise<void> {
    try {
      await this.contestWinnerNotifyService.enqueueWinnerNotifications(
        contestId,
      );
    } catch (error: any) {
      this.logger.error(
        { err: error, contestId },
        'notifyWinners: не удалось поставить уведомления победителей в очередь',
      );
    }
  }

  async cancelContest(id: number): Promise<ContestWithRelations> {
    const contest = await this.contestRepo.findByIdWithRelations(id);

    if (!contest) {
      throw new NotFoundException('Конкурс не найден');
    }

    if (contest.status === ContestStatus.CANCELLED) {
      throw new BadRequestException('Конкурс уже отменён');
    }

    if (contest.status === ContestStatus.COMPLETED) {
      throw new BadRequestException('Нельзя отменить завершённый конкурс');
    }

    const hasWinners = Boolean(contest.winners?.length);

    if (hasWinners && contest.winnerStrategy !== WinnerStrategy.MANUAL) {
      throw new BadRequestException(
        'Нельзя отменить конкурс с выбранными победителями, если стратегия не manual',
      );
    }

    await this.contestJobsService.removeContestJobs(contest.id);
    await this.contestPublicationService.cancelContestPublications(contest.id);

    await this.contestRepo.update(contest.id, {
      status: ContestStatus.CANCELLED,
    });

    const updatedContest = await this.contestRepo.findByIdWithRelations(id);

    if (!updatedContest) {
      throw new NotFoundException('Конкурс не найден после отмены');
    }

    return updatedContest;
  }

  /**
   * Общий grace-период для конкурса, который должен был завершиться, но пока
   * не может (MANUAL без выбранных победителей / авто-розыгрыш без достаточного
   * числа участников): сдвигаем дедлайн на WINNER_SELECTION_GRACE_PERIOD_MS,
   * перепланируем finish-job на новое время и уведомляем админов. Причина и
   * призыв к действию подставляются вызывающим (reasonLine / actionLine).
   */
  private async scheduleFinishGracePeriod(
    contest: { id: number; name: string; endDate: Date },
    logMessage: string,
    reasonLine: string,
    actionLine: string,
  ): Promise<void> {
    const extendedEndDate = new Date(
      contest.endDate.getTime() + WINNER_SELECTION_GRACE_PERIOD_MS,
    );

    this.logger.warn({ contestId: contest.id, extendedEndDate }, logMessage);

    await this.contestRepo.update(contest.id, { endDate: extendedEndDate });
    await this.contestJobsService.scheduleFinishRetry(
      contest.id,
      extendedEndDate,
    );
    await this.notifyAdminsAboutContestGrace(
      contest,
      extendedEndDate,
      reasonLine,
      actionLine,
    );
  }

  private async notifyAdminsAboutContestGrace(
    contest: { id: number; name: string },
    extendedEndDate: Date,
    reasonLine: string,
    actionLine: string,
  ): Promise<void> {
    try {
      const admins = getAdminTelegramIdsFromEnv();

      if (!admins.length) {
        this.logger.warn(
          'Нет админов в ADMIN_IDS для уведомления об отложенном завершении конкурса',
        );
        return;
      }

      const extendedEndDateStr = extendedEndDate.toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        dateStyle: 'short',
        timeStyle: 'short',
      });

      const text =
        `⚠️ Конкурс «${contest.name}» (ID: ${contest.id}) должен был завершиться, ` +
        `но ${reasonLine}\n\n` +
        `Завершение отложено до ${extendedEndDateStr} (МСК). ${actionLine}`;

      for (const admin of admins) {
        try {
          await this.telegramService.sendMailingMessage({
            chatId: admin,
            text,
          });
        } catch (error: any) {
          this.logger.error(
            { err: error, adminTelegramId: admin, contestId: contest.id },
            'notifyAdminsAboutContestGrace: не удалось отправить уведомление',
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        { err: error, contestId: contest.id },
        'notifyAdminsAboutContestGrace: ошибка',
      );
    }
  }
}
