import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import {
  BOT_MESSAGE_REPOSITORY,
  CONTEST_REPOSITORY,
} from 'src/common/constants';
import type { IBotMessageRepository, IContestRepository } from '../interfaces';
import { BotMessageStatus, BotMessageType } from 'src/common/enums/bot';
import { ContestWinnerStatus } from 'src/common/enums/contest';
import { ContestWinner } from '../entities';
import { getAdminTelegramIdsFromEnv } from 'src/common/helpers/admin-ids.helper';
import { ContestWinnerService } from './contest-winner.service';
import { buildWinnerNotificationText } from './contest-winner-message.util';
import { buildWinnersSummaryText } from './contest-winners-summary.util';
import { toResultsWinners } from './contest-results-text.util';

/** Имя джоба сводки администраторам в очереди contest-winner-notify. */
export const WINNERS_SUMMARY_JOB = 'notify-winners-summary';

export interface WinnersSummaryJobData {
  contestId: number;
}

/**
 * Уведомление намеренно текстовое, без картинки конкурса: sendMailingMessage
 * перезаливает файл на КАЖДОГО получателя (file_id мы не храним), а отсутствие
 * файла на диске роняет отправку. Победитель картинку уже видел в посте.
 */
export interface WinnerNotifyJobData {
  contestId: number;
  userId: number;
  telegramId: string;
  text: string;

  /**
   * id строки победителя — нужен для кнопок подтверждения (уходит в
   * callback_data). Заполняется, только когда у конкурса включено
   * requireWinnerConfirmation; иначе уведомление уходит без кнопок, как прежде.
   */
  winnerId?: number;
}

/**
 * Постановка личных уведомлений победителям. Отправку делает процессор
 * очереди contest-winner-notify — здесь только выборка и enqueue.
 */
@Injectable()
export class ContestWinnerNotifyService {
  constructor(
    @Inject(CONTEST_REPOSITORY)
    private readonly contestRepo: IContestRepository,

    @Inject(BOT_MESSAGE_REPOSITORY)
    private readonly botMessageRepo: IBotMessageRepository,

    @InjectQueue('contest-winner-notify')
    private readonly notifyQueue: Queue,

    private readonly contestWinnerService: ContestWinnerService,
    private readonly logger: Logger,
  ) {}

  /**
   * Ставит по джобу на каждого победителя, которому есть куда писать.
   *
   * Пропускаются двое: фиктивный победитель (ник без TG-аккаунта — адресата
   * попросту нет) и реальный без telegramId. Обоих считаем и логируем, чтобы
   * расхождение «победителей N, уведомлений M» было объяснимым.
   *
   * Идемпотентность — по jobId вида contest:<id>:winner-<userId>: повторный
   * вызов (ретрай завершения, двойной клик) не поставит второй джоб. Вторая
   * линия защиты — проверка уже отправленного в самом процессоре.
   */
  async enqueueWinnerNotifications(contestId: number): Promise<{
    queued: number;
    skipped: number;
  }> {
    const contest = await this.contestRepo.findByParams({ id: contestId });

    if (!contest) {
      this.logger.warn(
        { contestId },
        'enqueueWinnerNotifications: конкурс не найден, уведомления не ставим',
      );
      return { queued: 0, skipped: 0 };
    }

    const winners =
      await this.contestWinnerService.getContestWinners(contestId);

    const jobs: Array<{
      name: string;
      data: WinnerNotifyJobData;
      opts: object;
    }> = [];
    let skipped = 0;

    for (const winner of winners) {
      const telegramId = winner.user?.telegramId;

      if (winner.userId == null || !telegramId) {
        skipped++;
        continue;
      }

      // Кнопки нужны только тому, у кого решение ещё не принято. Строка могла
      // уже быть CONFIRMED (подтверждение выключено — так проставляет БД), и
      // тогда уведомление уходит прежним, без кнопок.
      const awaitsConfirmation =
        winner.status === ContestWinnerStatus.PENDING_CONFIRMATION;

      jobs.push({
        name: 'notify-winner',
        data: {
          contestId,
          userId: winner.userId,
          telegramId: String(telegramId),
          text: buildWinnerNotificationText({
            contestName: contest.name,
            place: winner.place,
            confirmationDeadline: awaitsConfirmation
              ? winner.confirmationDeadline
              : null,
            confirmationHours: contest.confirmationHours,
          }),
          winnerId: awaitsConfirmation ? winner.id : undefined,
        },
        // Разделитель перед userId — дефис, а не двоеточие: BullMQ принимает
        // кастомный jobId с двоеточиями только ровно из трёх сегментов
        // (Job.validateOptions, совместимость со старыми repeatable-джобами),
        // а `contest:1:winner:2` давал четыре — addBulk падал с «Custom Id
        // cannot contain :» и не ставил НИ ОДНОГО джоба. Ошибку глушил catch
        // в notifyWinners, поэтому конкурс завершался штатно, а уведомлений
        // не было вовсе — bot_messages оставалась пустой при живых победителях.
        opts: { jobId: `contest:${contestId}:winner-${winner.userId}` },
      });
    }

    if (jobs.length) {
      await this.notifyQueue.addBulk(jobs);
    } else {
      // Уведомлять некого (нет победителей либо все без TG-аккаунта) — значит,
      // ни один notify-джоб не отработает и не позовёт сводку. Ставим её сразу,
      // иначе администратор не узнает о завершении вовсе.
      await this.enqueueSummary(contestId);
    }

    this.logger.log(
      { contestId, winners: winners.length, queued: jobs.length, skipped },
      'enqueueWinnerNotifications: уведомления победителей поставлены в очередь',
    );

    return { queued: jobs.length, skipped };
  }

  /**
   * Зовётся процессором после каждого уведомления. Сводку ставим только когда
   * по всем адресатам есть итог (SENT или FAILED) — иначе админ получил бы
   * отчёт с недосчитанными доставками.
   *
   * Гонка последних джобов безопасна: одинаковый jobId не даст BullMQ создать
   * второй джоб сводки.
   */
  async enqueueSummaryIfComplete(contestId: number): Promise<void> {
    const winners =
      await this.contestWinnerService.getContestWinners(contestId);
    const notifiable = winners.filter(
      (winner) => winner.userId != null && winner.user?.telegramId,
    );

    const processed = await this.getProcessedUserIds(contestId);

    if (processed.size < notifiable.length) return;

    await this.enqueueSummary(contestId);
  }

  /**
   * Текст сводки и получатели. Отправку делает процессор — сюда Telegram
   * не тянем. null → конкурс исчез или в ADMIN_IDS никого нет.
   */
  async buildWinnersSummary(contestId: number): Promise<{
    text: string;
    adminTelegramIds: string[];
  } | null> {
    const contest = await this.contestRepo.findByParams({ id: contestId });

    if (!contest) {
      this.logger.warn(
        { contestId },
        'buildWinnersSummary: конкурс не найден, сводку не шлём',
      );
      return null;
    }

    const adminTelegramIds = getAdminTelegramIdsFromEnv();

    if (!adminTelegramIds.length) {
      this.logger.warn(
        { contestId },
        'buildWinnersSummary: в ADMIN_IDS никого нет, сводку слать некому',
      );
      return null;
    }

    const winners =
      await this.contestWinnerService.getContestWinners(contestId);

    const [sentIds, failedIds] = await Promise.all([
      this.botMessageRepo.findUserIdsByStatus(
        contestId,
        BotMessageType.CONTEST_WINNER,
        BotMessageStatus.SENT,
      ),
      this.botMessageRepo.findUserIdsByStatus(
        contestId,
        BotMessageType.CONTEST_WINNER,
        BotMessageStatus.FAILED,
      ),
    ]);

    const sent = new Set(sentIds);
    const failed = new Set(failedIds);

    const isNotifiable = (winner: ContestWinner) =>
      winner.userId != null && !!winner.user?.telegramId;

    return {
      text: buildWinnersSummaryText({
        contestId,
        contestName: contest.name,
        winners: toResultsWinners(winners),
        deliveredCount: winners.filter(
          (winner) => winner.userId != null && sent.has(winner.userId),
        ).length,
        undelivered: toResultsWinners(
          winners.filter(
            (winner) => winner.userId != null && failed.has(winner.userId),
          ),
        ),
        skipped: toResultsWinners(winners.filter((w) => !isNotifiable(w))),
      }),
      adminTelegramIds,
    };
  }

  private async enqueueSummary(contestId: number): Promise<void> {
    await this.notifyQueue.add(
      WINNERS_SUMMARY_JOB,
      { contestId },
      { jobId: `contest:${contestId}:winners-summary` },
    );
  }

  /** Победители, по которым уведомление уже имеет исход — доставлено или нет. */
  private async getProcessedUserIds(contestId: number): Promise<Set<number>> {
    const [sentIds, failedIds] = await Promise.all([
      this.botMessageRepo.findUserIdsByStatus(
        contestId,
        BotMessageType.CONTEST_WINNER,
        BotMessageStatus.SENT,
      ),
      this.botMessageRepo.findUserIdsByStatus(
        contestId,
        BotMessageType.CONTEST_WINNER,
        BotMessageStatus.FAILED,
      ),
    ]);

    return new Set([...sentIds, ...failedIds]);
  }
}
