import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import {
  ContestParticipationReadRepository,
  ContestReadRepository,
  ContestWriteRepository,
} from '../repositories';
import {
  CONTEST_PARTICIPATE_READ_REPOSITORY,
  CONTEST_READ_REPOSITORY,
  CONTEST_WRITE_REPOSITORY,
} from 'src/shared/commons/constants';
import { Contest } from '../entities';
import { ContestStatus, WinnerStrategy } from 'src/shared/enums/contest';
import { ContestJobsService } from '../jobs/services';
import { ContestWinnerService } from './contest-winner.service';
import { ContestPublicationService } from './contest-publication.service';
import { TelegramService } from 'src/modules/bot/bot.service';
import { getAdminTelegramIdsFromEnv } from 'src/common/helpers/admin-ids.helper';

const WINNER_SELECTION_GRACE_PERIOD_MS = 2 * 60 * 60 * 1000;

@Injectable()
export class ContestLifecycleService {
  constructor(
    @Inject(CONTEST_READ_REPOSITORY)
    private readonly contestReadRepo: ContestReadRepository,

    @Inject(CONTEST_WRITE_REPOSITORY)
    private readonly contestWriteRepo: ContestWriteRepository,

    @Inject(CONTEST_PARTICIPATE_READ_REPOSITORY)
    private readonly contestParticipationReadRepo: ContestParticipationReadRepository,

    @InjectQueue('contest-publication')
    private readonly publicationQueue: Queue,

    private readonly contestJobsService: ContestJobsService,
    private readonly contestWinnerService: ContestWinnerService,
    private readonly contestPublicationService: ContestPublicationService,
    private readonly logger: Logger,
    private readonly dataSource: DataSource,

    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  async activateContestIfDue(contestId: number): Promise<void> {
    const contest = await this.contestReadRepo.findByParams({ id: contestId });
    if (!contest) return;

    if (contest.status !== ContestStatus.PENDING) return;

    const now = new Date();
    if (contest.startDate > now) return;

    await this.contestWriteRepo.updateStatusIfCurrent(
      contestId,
      ContestStatus.PENDING,
      ContestStatus.ACTIVE,
    );
  }

  async isContestCompleted(contestId: number): Promise<boolean> {
    const contest = await this.contestReadRepo.findByParams({ id: contestId });
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
      const contest =
        await this.contestReadRepo.findByIdWithRelations(contestId);
      if (!contest) return;

      if (contest.status === ContestStatus.COMPLETED) return;

      const now = new Date();
      if (contest.endDate > now) return;

      const participants =
        await this.contestParticipationReadRepo.findManyByContestId(contest.id);
      const hasParticipants = participants.length > 0;

      if (hasParticipants) {
        if (contest.winnerStrategy === WinnerStrategy.MANUAL) {
          const existingWinners =
            await this.contestWinnerService.getContestWinners(contest.id);

          if (existingWinners.length === 0) {
            // Не завершаем конкурс: даём админу ещё немного времени выбрать
            // победителя вручную, сдвигая дедлайн и перепланируя finish-job.
            // Уведомление отправляется на каждой попытке, чтобы админ не забыл.
            const extendedEndDate = new Date(
              contest.endDate.getTime() + WINNER_SELECTION_GRACE_PERIOD_MS,
            );

            this.logger.warn(
              { contestId: contest.id, extendedEndDate },
              'finishContestIdempotent: MANUAL-стратегия без выбранного победителя, откладываем завершение',
            );

            await this.contestWriteRepo.update(contest.id, {
              endDate: extendedEndDate,
            });
            await this.contestJobsService.scheduleFinishRetry(
              contest.id,
              extendedEndDate,
            );
            await this.notifyAdminsAboutMissingManualWinner(
              contest,
              extendedEndDate,
            );

            return;
          } else {
            await this.contestWinnerService.resolveAndSaveWinners(contest);
          }
        } else {
          await this.contestWinnerService.resolveAndSaveWinners(contest);
        }
      }

      const changed =
        await this.contestWriteRepo.updateStatusIfNotCompleted(contestId);
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
    } finally {
      // Освобождаем лок при любом исходе — в том числе при исключении.
      // Без finally: если resolveAndSaveWinners выбросит ошибку, лок
      // останется висеть до закрытия соединения (может быть долго).
      await this.dataSource.query('SELECT pg_advisory_unlock($1)', [contestId]);
    }
  }

  async completeContest(contestId: number): Promise<Contest> {
    const contest = await this.contestReadRepo.findByIdWithRelations(contestId);

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

    await this.contestWinnerService.resolveAndSaveWinners(contest);

    await this.contestWriteRepo.update(contest.id, {
      status: ContestStatus.COMPLETED,
      buttonText: 'Конкурс завершён',
    });

    const updatedContest = await this.contestReadRepo.findByIdWithRelations(
      contest.id,
    );

    if (!updatedContest) {
      throw new NotFoundException('Конкурс не найден после завершения');
    }

    await this.contestPublicationService.syncPublishedPosts(updatedContest);

    return updatedContest;
  }

  async cancelContest(id: number): Promise<Contest> {
    const contest = await this.contestReadRepo.findByIdWithRelations(id);

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

    await this.contestWriteRepo.update(contest.id, {
      status: ContestStatus.CANCELLED,
    });

    const updatedContest = await this.contestReadRepo.findByIdWithRelations(id);

    if (!updatedContest) {
      throw new NotFoundException('Конкурс не найден после отмены');
    }

    return updatedContest;
  }

  private async notifyAdminsAboutMissingManualWinner(
    contest: Contest,
    extendedEndDate: Date,
  ): Promise<void> {
    try {
      const admins = getAdminTelegramIdsFromEnv();

      if (!admins.length) {
        this.logger.warn(
          'Нет админов в ADMIN_IDS для уведомления о невыбранном победителе',
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
        'но для него не выбраны победители (стратегия: вручную).\n\n' +
        `Завершение отложено до ${extendedEndDateStr} (МСК). ` +
        'Пожалуйста, назначьте победителей в панели администратора до этого времени.';

      for (const admin of admins) {
        try {
          await this.telegramService.sendMailingMessage({
            chatId: admin,
            text,
          });
        } catch (error: any) {
          this.logger.error(
            { err: error, adminTelegramId: admin, contestId: contest.id },
            'notifyAdminsAboutMissingManualWinner: не удалось отправить уведомление',
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        { err: error, contestId: contest.id },
        'notifyAdminsAboutMissingManualWinner: ошибка',
      );
    }
  }
}
