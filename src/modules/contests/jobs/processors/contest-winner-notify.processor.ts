import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import Bottleneck from 'bottleneck';
import { Inject } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { TelegramService } from 'src/modules/bot/bot.service';
import { jobMeta } from 'src/common/helpers/job-meta.helper';
import { BOT_MESSAGE_REPOSITORY } from 'src/common/constants';
import type { IBotMessageRepository } from '../../interfaces';
import { BotMessageContentType, BotMessageType } from 'src/common/enums/bot';
import {
  ContestWinnerNotifyService,
  WinnersSummaryJobData,
  WinnerNotifyJobData,
  WINNERS_SUMMARY_JOB,
  UNFILLED_PLACE_JOB,
  UnfilledPlaceJobData,
} from '../../services/contest-winner-notify.service';
import {
  buildConfirmCallbackData,
  buildDeclineCallbackData,
} from '../../contest-winner-confirm.update';

const telegramLimiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 60,
});

@Processor('contest-winner-notify')
export class ContestWinnerNotifyProcessor extends WorkerHost {
  constructor(
    @Inject(BOT_MESSAGE_REPOSITORY)
    private readonly botMessageRepo: IBotMessageRepository,

    private readonly contestWinnerNotifyService: ContestWinnerNotifyService,
    private readonly telegramService: TelegramService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(
    job: Job<
      WinnerNotifyJobData | WinnersSummaryJobData | UnfilledPlaceJobData
    >,
  ): Promise<void> {
    if (job.name === WINNERS_SUMMARY_JOB) {
      await this.sendSummary(job as Job<WinnersSummaryJobData>);
      return;
    }

    if (job.name === UNFILLED_PLACE_JOB) {
      await this.sendUnfilledPlace(job as Job<UnfilledPlaceJobData>);
      return;
    }

    await this.notifyWinner(job as Job<WinnerNotifyJobData>);
  }

  private async notifyWinner(job: Job<WinnerNotifyJobData>): Promise<void> {
    const { contestId, userId, telegramId, text, winnerId } = job.data;

    // Защита от повторной отправки при ретрае: сообщение могло уйти, а запись
    // в БД — упасть. BullMQ не гонит один джоб параллельно, так что гонки
    // между воркерами здесь нет, только ретрай.
    const alreadySent = await this.botMessageRepo.existsSent({
      contestId,
      userId,
      type: BotMessageType.CONTEST_WINNER,
    });

    if (alreadySent) {
      this.logger.warn(
        { ...jobMeta(job), contestId, userId },
        'notify-winner: уведомление уже отправлено, пропускаем ретрай',
      );
      return;
    }

    const contentType = BotMessageContentType.TEXT;

    try {
      // Кнопки только у конкурсов с подтверждением приза: winnerId проставлен
      // ровно тогда, когда строка ждёт решения победителя.
      const callbackButtons =
        winnerId === undefined
          ? undefined
          : [
              {
                text: '✅ Подтвердить',
                callbackData: buildConfirmCallbackData(winnerId),
              },
              {
                text: '❌ Отказаться',
                callbackData: buildDeclineCallbackData(winnerId),
              },
            ];

      const sent = await telegramLimiter.schedule(() =>
        this.telegramService.sendMailingMessage({
          chatId: telegramId,
          text,
          callbackButtons,
        }),
      );

      await this.botMessageRepo.recordSent({
        contestId,
        userId,
        chatId: sent.chatId,
        telegramMessageId: sent.messageId,
        type: BotMessageType.CONTEST_WINNER,
        contentType,
        payload: { text },
      });

      this.logger.debug(
        { ...jobMeta(job), contestId, userId, messageId: sent.messageId },
        'notify-winner: sent',
      );

      await this.tryEnqueueSummary(contestId);
    } catch (error: any) {
      const code = error?.response?.error_code;
      const description = error?.response?.description;
      const errorText = description || error?.message || String(error);

      // 403 — самый частый исход: бот не может писать первым тому, кто не
      // запускал /start, а участники приходят из мини-аппа. Это не сбой
      // доставки, а отсутствие права на неё: ретраи бессмысленны, пишем FAILED
      // и выходим успешно, чтобы джоб не молотил впустую. 400 — тоже
      // перманентный (чат не найден, юзер удалён).
      const permanent = code === 403 || code === 400;

      if (permanent) {
        await this.botMessageRepo.recordFailed({
          contestId,
          userId,
          chatId: telegramId,
          type: BotMessageType.CONTEST_WINNER,
          contentType,
          error: errorText,
        });

        this.logger.warn(
          { ...jobMeta(job), contestId, userId, code, tg: errorText },
          'notify-winner: перманентный отказ Telegram -> FAILED без ретрая',
        );

        await this.tryEnqueueSummary(contestId);
        return;
      }

      const attempt = job.attemptsMade + 1;
      const maxAttempts = job.opts?.attempts ?? 3;
      const lastAttempt = attempt >= maxAttempts;

      // Временную ошибку ретраим. На последней попытке фиксируем FAILED —
      // иначе победитель тихо остался бы без уведомления и без следа.
      if (lastAttempt) {
        await this.botMessageRepo.recordFailed({
          contestId,
          userId,
          chatId: telegramId,
          type: BotMessageType.CONTEST_WINNER,
          contentType,
          error: errorText,
        });

        await this.tryEnqueueSummary(contestId);
      }

      this.logger.error(
        {
          ...jobMeta(job),
          contestId,
          userId,
          code,
          attempt,
          maxAttempts,
          tg: errorText,
        },
        'notify-winner: временная ошибка -> ретрай',
      );

      throw error;
    }
  }

  /**
   * Сводка администраторам по итогам конкурса. Ставится последним отработавшим
   * уведомлением, поэтому джоб один на конкурс (дедупликация по jobId).
   */
  private async sendSummary(job: Job<WinnersSummaryJobData>): Promise<void> {
    const { contestId } = job.data;

    const summary =
      await this.contestWinnerNotifyService.buildWinnersSummary(contestId);

    if (!summary) return;

    for (const adminTelegramId of summary.adminTelegramIds) {
      try {
        await telegramLimiter.schedule(() =>
          this.telegramService.sendMailingMessage({
            chatId: adminTelegramId,
            text: summary.text,
          }),
        );
      } catch (error: any) {
        // Недоступность одного администратора не должна лишать сводки
        // остальных — и тем более ретраить рассылку всем заново.
        this.logger.error(
          { ...jobMeta(job), contestId, adminTelegramId, err: error },
          'notify-winners-summary: не удалось отправить сводку администратору',
        );
      }
    }

    this.logger.log(
      { ...jobMeta(job), contestId, admins: summary.adminTelegramIds.length },
      'notify-winners-summary: сводка отправлена',
    );
  }

  /**
   * «Место осталось незакрытым»: очередь жеребьёвки исчерпана, заменить
   * отказавшегося некем. Решение за человеком, поэтому просто зовём админов.
   */
  private async sendUnfilledPlace(
    job: Job<UnfilledPlaceJobData>,
  ): Promise<void> {
    const { contestId, place, contestName, adminTelegramIds, postUrls } =
      job.data;

    const links = postUrls?.length
      ? `\n\n${postUrls
          .map((url, index) =>
            postUrls.length === 1
              ? `<a href="${url}">Пост конкурса</a>`
              : `<a href="${url}">Площадка ${index + 1}</a>`,
          )
          .join('\n')}`
      : '';

    const text =
      `⚠️ Конкурс «${contestName}» (id ${contestId}): место ${place} осталось ` +
      `незакрытым — победитель не подтвердил приз, а участники для замены ` +
      `закончились. Нужно решение вручную.${links}`;

    for (const adminTelegramId of adminTelegramIds) {
      try {
        await telegramLimiter.schedule(() =>
          this.telegramService.sendMailingMessage({
            chatId: adminTelegramId,
            text,
          }),
        );
      } catch (error: any) {
        this.logger.error(
          { ...jobMeta(job), contestId, adminTelegramId, err: error },
          'notify-unfilled-place: не удалось уведомить администратора',
        );
      }
    }
  }

  /**
   * Сводка — побочный эффект уведомления, а не его часть: её сбой не должен
   * ронять джоб и заставлять переотправлять уже доставленное сообщение.
   */
  private async tryEnqueueSummary(contestId: number): Promise<void> {
    try {
      await this.contestWinnerNotifyService.enqueueSummaryIfComplete(contestId);
    } catch (error: any) {
      this.logger.error(
        { contestId, err: error },
        'notify-winner: не удалось поставить сводку администраторам',
      );
    }
  }
}
