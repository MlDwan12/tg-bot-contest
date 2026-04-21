import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import Bottleneck from 'bottleneck';
import { ContestsService } from '../../services/contests.service';
import { TelegramService } from 'src/modules/bot/bot.service';
import { Logger } from 'nestjs-pino';
import { jobMeta } from 'src/common/helpers/job-meta.helper';

const telegramLimiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 60,
});

function formatTelegramError(e: any): {
  code?: number;
  retryAfterSec?: number;
  text: string;
} {
  const code = e?.response?.error_code;
  const desc = e?.response?.description;
  const retryAfterSec = e?.response?.parameters?.retry_after;
  const msg = e?.message;

  const text =
    [
      code ? `code=${code}` : null,
      desc ? `desc=${desc}` : null,
      retryAfterSec ? `retry_after=${retryAfterSec}s` : null,
      msg ? `msg=${msg}` : null,
    ]
      .filter(Boolean)
      .join(' | ') || String(e);

  return { code, retryAfterSec, text };
}

@Processor('contest-publication')
export class ContestPublicationProcessor extends WorkerHost {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly telegramService: TelegramService,
    private readonly logger: Logger,
  ) {
    super();
    this.logger.log('ContestPublicationProcessor initialized');
  }

  async process(
    job: Job<{ publicationId: number; hasParticipants?: boolean }>,
    token?: string,
  ) {
    this.logger.error(
      {
        queue: job.queueName,
        jobId: job.id,
        jobName: job.name,
        data: job.data,
      },
      'ContestPublicationProcessor got job',
    );
    if (job.name === 'sendPublication') {
      const { publicationId } = job.data;

      this.logger.debug(
        { ...jobMeta(job), publicationId },
        'sendPublication: start',
      );

      const publication =
        await this.contestsService.claimPublication(publicationId);

      if (!publication) {
        this.logger.warn(
          { ...jobMeta(job), publicationId },
          'sendPublication: claim skipped (already processed or not pending)',
        );
        return;
      }

      this.logger.debug(
        {
          ...jobMeta(job),
          publicationId,
          chatId: String(publication.chatId),
          attemptsInDb: publication.attempts,
          status: publication.status,
        },
        'sendPublication: claimed',
      );

      const payload = publication.payload;

      if (!payload?.text || !payload?.buttonUrl) {
        this.logger.error(
          { ...jobMeta(job), publicationId, payload },
          'sendPublication: empty payload -> fail',
        );
        await this.contestsService.failPublication(
          publicationId,
          'Empty payload',
        );
        return;
      }

      try {
        const sent = await telegramLimiter.schedule(() =>
          this.telegramService.sendContestMessage({
            chatId: String(publication.chatId),
            text: payload.text,
            photoUrl: payload.photoUrl,
            buttonText: payload.buttonText ?? 'Участвовать',
            buttonUrl: payload.buttonUrl,
          }),
        );

        this.logger.debug(
          { ...jobMeta(job), publicationId, telegramMessageId: sent.messageId },
          'sendPublication: telegram sent',
        );

        await this.contestsService.markPublicationPublished(
          publicationId,
          sent.messageId,
        );

        this.logger.debug(
          { ...jobMeta(job), publicationId },
          'sendPublication: marked published',
        );
      } catch (e: any) {
        const meta = formatTelegramError(e);

        // 400/403 — перманентные
        if (meta.code === 400 || meta.code === 403) {
          this.logger.warn(
            { ...jobMeta(job), publicationId, tg: meta.text },
            'sendPublication: permanent telegram error -> fail',
          );
          await this.contestsService.failPublication(publicationId, meta.text);
          return;
        }

        // 429 — переносим job в delayed и не тратим attempts
        if (
          meta.code === 429 &&
          typeof meta.retryAfterSec === 'number' &&
          meta.retryAfterSec > 0
        ) {
          this.logger.warn(
            { ...jobMeta(job), publicationId, tg: meta.text },
            'sendPublication: rate limited -> delayed',
          );

          await this.contestsService.bumpPublicationError(
            publicationId,
            meta.text,
          );

          if (!token) {
            this.logger.error(
              { ...jobMeta(job), publicationId },
              'sendPublication: missing token for moveToDelayed -> throw',
            );
            throw e;
          }

          const delayMs = Math.max(
            1000,
            Math.min(meta.retryAfterSec * 1000, 10 * 60 * 1000),
          );
          const ts = Date.now() + delayMs;

          this.logger.warn(
            { ...jobMeta(job), publicationId, delayMs, runAtTs: ts },
            'sendPublication: moved to delayed',
          );

          await job.moveToDelayed(ts, token);
          return;
        }

        // временные — ретрай по attempts/backoff очереди
        this.logger.error(
          { ...jobMeta(job), publicationId, tg: meta.text },
          'sendPublication: temporary error -> retry via throw',
        );

        await this.contestsService.bumpPublicationError(
          publicationId,
          meta.text,
        );
        throw e;
      }
    }

    if (job.name === 'updateFinishedButton') {
      const { publicationId, hasParticipants } = job.data;

      this.logger.debug(
        { ...jobMeta(job), publicationId },
        'updateFinishedButton: start',
      );

      // Нужны chatId + telegramMessageId + contestId
      const pub =
        await this.contestsService.getPublicationForButtonUpdate(publicationId);

      if (!pub) {
        this.logger.warn(
          { ...jobMeta(job), publicationId },
          'updateFinishedButton: publication not found -> skip',
        );
        return;
      }

      const messageId = pub.telegramMessageId;
      if (typeof messageId !== 'number') {
        this.logger.warn(
          { ...jobMeta(job), publicationId },
          'updateFinishedButton: no telegramMessageId -> skip',
        );
        return;
      }

      // Идемпотентность: если конкурс ещё не завершён — выходим
      const isFinished = await this.contestsService.isContestCompleted(
        pub.contestId,
      );
      if (!isFinished) {
        this.logger.debug(
          { ...jobMeta(job), publicationId, contestId: pub.contestId },
          'updateFinishedButton: contest not completed yet -> skip',
        );
        return;
      }
      try {
        await telegramLimiter.schedule(() =>
          this.telegramService.updateContestMessageButton({
            chatId: String(pub.chatId),
            messageId,
            buttonText: hasParticipants ? 'Конкурс завершён' : undefined,
            buttonUrl: hasParticipants
              ? `${process.env.MINI_APP_URL}?startapp=${pub.chatId}_${pub.contestId}`
              : undefined,
          }),
        );

        this.logger.debug(
          { ...jobMeta(job), publicationId },
          'updateFinishedButton: updated',
        );

        return;
      } catch (e: any) {
        const meta = formatTelegramError(e);

        if (meta.code === 400 || meta.code === 403) {
          this.logger.warn(
            { ...jobMeta(job), publicationId, tg: meta.text },
            'updateFinishedButton: permanent telegram error -> skip',
          );
          await this.contestsService.bumpPublicationError(
            publicationId,
            meta.text,
          );
          return;
        }

        // 429 — переносим job в delayed, аналогично sendPublication
        if (
          meta.code === 429 &&
          typeof meta.retryAfterSec === 'number' &&
          meta.retryAfterSec > 0
        ) {
          await this.contestsService.bumpPublicationError(
            publicationId,
            meta.text,
          );

          if (!token) throw e;

          const delayMs = Math.max(
            1000,
            Math.min(meta.retryAfterSec * 1000, 10 * 60 * 1000),
          );
          await job.moveToDelayed(Date.now() + delayMs, token);
          return;
        }

        await this.contestsService.bumpPublicationError(
          publicationId,
          meta.text,
        );
        throw e;
      }
    }
  }
}
