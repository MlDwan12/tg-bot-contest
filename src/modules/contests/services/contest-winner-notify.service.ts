import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import {
  BOT_MESSAGE_REPOSITORY,
  CONTEST_PARTICIPATE_REPOSITORY,
  CONTEST_REPOSITORY,
} from 'src/common/constants';
import type {
  IBotMessageRepository,
  IContestParticipationRepository,
  IContestRepository,
} from '../interfaces';
import { BotMessageStatus, BotMessageType } from 'src/common/enums/bot';
import { ContestWinnerStatus } from 'src/common/enums/contest';
import { ContestWinner } from '../entities';
import { CONFIRMATION_DEADLINE_JOB } from '../jobs/contest-winner-confirm.jobs';
import { getAdminTelegramIdsFromEnv } from 'src/common/helpers/admin-ids.helper';
import { ContestWinnerService } from './contest-winner.service';
import { buildWinnerNotificationText } from './contest-winner-message.util';
import {
  buildAllPostLinks,
  ContestPostRef,
  findPostLinkForChat,
} from './contest-post-link.util';
import { buildWinnersSummaryText } from './contest-winners-summary.util';
import { toResultsWinners } from './contest-results-text.util';

/** Имя джоба сводки администраторам в очереди contest-winner-notify. */
export const WINNERS_SUMMARY_JOB = 'notify-winners-summary';

/** Имя джоба «место осталось незакрытым» — очередь жеребьёвки исчерпана. */
export const UNFILLED_PLACE_JOB = 'notify-unfilled-place';

export interface UnfilledPlaceJobData {
  contestId: number;
  place: number;
  contestName: string;
  adminTelegramIds: string[];
  postUrls?: string[];
}

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

    @Inject(CONTEST_PARTICIPATE_REPOSITORY)
    private readonly contestParticipationRepo: IContestParticipationRepository,

    @InjectQueue('contest-winner-notify')
    private readonly notifyQueue: Queue,

    @InjectQueue('contest-winner-confirm')
    private readonly confirmQueue: Queue,

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

    // Публикации грузим один раз на конкурс, а не на каждого победителя.
    const posts = await this.loadPostRefs(contestId);

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

      const chatId = await this.findParticipationChatId(
        contestId,
        winner.userId,
      );

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
            postUrl: findPostLinkForChat(posts, chatId),
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

    // Дедлайны ставим ОТДЕЛЬНО от уведомлений и независимо от их исхода:
    // победитель мог не запускать бота (403), уведомление не дойдёт — но срок
    // всё равно должен истечь, иначе место зависнет за ним навсегда.
    await this.scheduleConfirmationDeadlines(contestId, winners);

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
   * Уведомление ОДНОМУ победителю — тому, кто занял место по автодобору.
   * Отдельный вход нужен потому, что enqueueWinnerNotifications ставит джобы
   * всем сразу, а остальных уведомлять повторно нельзя.
   */
  async enqueueWinnerNotification(
    contestId: number,
    winnerId: number,
  ): Promise<void> {
    const contest = await this.contestRepo.findByParams({ id: contestId });
    const winners =
      await this.contestWinnerService.getContestWinners(contestId);
    const winner = winners.find((row) => row.id === winnerId);
    const telegramId = winner?.user?.telegramId;

    if (!contest || !winner || winner.userId == null || !telegramId) {
      this.logger.warn(
        { contestId, winnerId },
        'enqueueWinnerNotification: уведомлять некого (нет конкурса, строки или telegramId)',
      );
      return;
    }

    const awaitsConfirmation =
      winner.status === ContestWinnerStatus.PENDING_CONFIRMATION;

    const posts = await this.loadPostRefs(contestId);
    const chatId = await this.findParticipationChatId(contestId, winner.userId);

    await this.notifyQueue.add(
      'notify-winner',
      {
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
          postUrl: findPostLinkForChat(posts, chatId),
        }),
        winnerId: awaitsConfirmation ? winner.id : undefined,
      },
      // jobId по id СТРОКИ, а не по userId: на одном месте побывает несколько
      // победителей, и ключ вида contest:<id>:winner-<userId> уже занят
      // отказавшимся. Три сегмента — требование BullMQ.
      { jobId: `contest:${contestId}:winner-row-${winnerId}` },
    );
  }

  /**
   * Место не закрыть — очередь жеребьёвки исчерпана. Сообщаем администраторам:
   * иначе приз потеряется молча, и об этом никто не узнает.
   */
  async notifyAdminsAboutUnfilledPlace(
    contestId: number,
    place: number,
  ): Promise<void> {
    const contest = await this.contestRepo.findByParams({ id: contestId });
    const adminTelegramIds = getAdminTelegramIdsFromEnv();

    if (!contest || !adminTelegramIds.length) return;

    await this.notifyQueue.add(
      UNFILLED_PLACE_JOB,
      {
        contestId,
        place,
        contestName: contest.name,
        adminTelegramIds,
        postUrls: buildAllPostLinks(await this.loadPostRefs(contestId)),
      },
      { jobId: `contest:${contestId}:unfilled-${place}` },
    );
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

    const posts = await this.loadPostRefs(contestId);

    // Отказавшихся и просроченных в списке победителей быть не должно: приз им
    // уже не достанется, а админ по этому списку связывается с людьми.
    const actual = winners.filter(
      (winner) =>
        winner.status !== ContestWinnerStatus.DECLINED &&
        winner.status !== ContestWinnerStatus.EXPIRED,
    );

    // Пока кто-то думает, состав не окончателен: сводка помечается
    // предварительной, иначе админ получает список, который завтра изменится,
    // и считает его итогом.
    const pending = actual.filter(
      (winner) => winner.status === ContestWinnerStatus.PENDING_CONFIRMATION,
    );

    return {
      text: buildWinnersSummaryText({
        contestId,
        contestName: contest.name,
        winners: toResultsWinners(actual),
        pendingCount: pending.length,
        pendingDeadline: pending[0]?.confirmationDeadline ?? null,
        deliveredCount: actual.filter(
          (winner) => winner.userId != null && sent.has(winner.userId),
        ).length,
        undelivered: toResultsWinners(
          actual.filter(
            (winner) => winner.userId != null && failed.has(winner.userId),
          ),
        ),
        skipped: toResultsWinners(actual.filter((w) => !isNotifiable(w))),
        postUrls: buildAllPostLinks(posts),
      }),
      adminTelegramIds,
    };
  }

  /**
   * Отложенные джобы на дедлайн подтверждения. Ставятся только тем строкам,
   * что реально ждут решения: при выключенном подтверждении статус CONFIRMED,
   * и дедлайнов нет вовсе.
   */
  async scheduleConfirmationDeadlines(
    contestId: number,
    winners: ContestWinner[],
  ): Promise<void> {
    for (const winner of winners) {
      if (
        winner.status !== ContestWinnerStatus.PENDING_CONFIRMATION ||
        !winner.confirmationDeadline
      ) {
        continue;
      }

      await this.scheduleConfirmationDeadline(
        contestId,
        winner.id,
        winner.place,
        winner.confirmationDeadline,
      );
    }
  }

  /** Один дедлайн — используется и при розыгрыше, и после автодобора. */
  async scheduleConfirmationDeadline(
    contestId: number,
    winnerId: number,
    place: number,
    deadline: Date,
  ): Promise<void> {
    await this.confirmQueue.add(
      CONFIRMATION_DEADLINE_JOB,
      { contestId, winnerId, place },
      {
        jobId: `contest:${contestId}:deadline-${winnerId}`,
        // Дедлайн мог уже наступить (очередь стояла, сервис лежал) — тогда
        // джоб выполняется сразу, а не отбрасывается отрицательной задержкой.
        delay: Math.max(0, deadline.getTime() - Date.now()),
      },
    );
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

  /**
   * Публикации конкурса в виде, пригодном для ссылок. Username канала нужен,
   * чтобы у публичных площадок ссылка открывалась у любого, а не только у
   * подписчиков (формат t.me/c/… работает лишь для состоящих в канале).
   */
  private async loadPostRefs(contestId: number): Promise<ContestPostRef[]> {
    const publications =
      await this.contestRepo.findPublicationsByContestId(contestId);

    return publications.map((publication) => ({
      chatId: publication.chatId,
      telegramMessageId: publication.telegramMessageId ?? null,
      channelUsername: publication.channel?.telegramUsername ?? null,
    }));
  }

  /** Чат, из которого победитель нажал «Участвовать» — groupId его участия. */
  private async findParticipationChatId(
    contestId: number,
    userId: number,
  ): Promise<string | null> {
    const participation = await this.contestParticipationRepo.findOneByParam({
      contestId,
      userId,
    });

    return participation?.groupId ?? null;
  }

  /**
   * Итоговая сводка — когда ждать больше нечего: все решения приняты либо
   * места закрыть некем. Первая сводка уходит сразу после завершения и
   * помечена предварительной, потому что состав ещё может смениться отказом;
   * без этой второй админ так и остался бы с устаревшим списком.
   *
   * Отдельный jobId: у предварительной свой ключ, и дедупликация не должна их
   * склеивать.
   */
  async enqueueFinalSummaryIfSettled(contestId: number): Promise<void> {
    const winners =
      await this.contestWinnerService.getContestWinners(contestId);

    const stillWaiting = winners.some(
      (winner) => winner.status === ContestWinnerStatus.PENDING_CONFIRMATION,
    );

    if (stillWaiting) return;

    await this.notifyQueue.add(
      WINNERS_SUMMARY_JOB,
      { contestId },
      { jobId: `contest:${contestId}:winners-final` },
    );
  }
}
