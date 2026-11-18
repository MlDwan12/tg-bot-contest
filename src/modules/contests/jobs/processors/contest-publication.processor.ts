import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import Bottleneck from 'bottleneck';
import { ContestPublicationService } from '../../services/contest-publication.service';
import { ContestLifecycleService } from '../../services/contest-lifecycle.service';
import { TelegramService } from 'src/modules/bot/bot.service';
import { Logger } from 'nestjs-pino';
import { jobMeta } from 'src/common/helpers/job-meta.helper';
import { ConfigService } from '@nestjs/config';
import { ContestWinnerService } from '../../services/contest-winner.service';
import { Inject } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import { CONTEST_REPOSITORY } from 'src/common/constants';
import type { IContestRepository } from '../../interfaces';
import { Contest } from '../../entities';
import { ResultsImageMode } from 'src/common/enums/contest';
import { getAdminTelegramIdsFromEnv } from 'src/common/helpers/admin-ids.helper';
import {
  RESULTS_EMOJI,
  buildContestResultsPost,
} from 'src/common/helpers/contest-results.helper';

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
    private readonly contestPublicationService: ContestPublicationService,
    private readonly contestLifecycleService: ContestLifecycleService,
    private readonly telegramService: TelegramService,
    private readonly logger: Logger,
    private readonly configService: ConfigService,
    private readonly contestWinnerService: ContestWinnerService,
    @Inject(CONTEST_REPOSITORY)
    private readonly contestRepo: IContestRepository,
  ) {
    super();
    this.logger.debug('ContestPublicationProcessor initialized');
  }

  async process(
    job: Job<{ publicationId: number; hasParticipants?: boolean }>,
    token?: string,
  ) {
    this.logger.debug(
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
        await this.contestPublicationService.claimPublication(publicationId);

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
        await this.contestPublicationService.failPublication(
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

        await this.contestPublicationService.markPublicationPublished(
          publicationId,
          sent.messageId,
        );

        this.logger.debug(
          { ...jobMeta(job), publicationId },
          'sendPublication: marked published',
        );
      } catch (e: any) {
        const meta = formatTelegramError(e);

        if (meta.code === 400 || meta.code === 403) {
          this.logger.warn(
            { ...jobMeta(job), publicationId, tg: meta.text },
            'sendPublication: permanent telegram error -> fail',
          );
          await this.contestPublicationService.failPublication(
            publicationId,
            meta.text,
          );
          return;
        }

        if (
          meta.code === 429 &&
          typeof meta.retryAfterSec === 'number' &&
          meta.retryAfterSec > 0
        ) {
          this.logger.warn(
            { ...jobMeta(job), publicationId, tg: meta.text },
            'sendPublication: rate limited -> delayed',
          );

          await this.contestPublicationService.bumpPublicationError(
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

        this.logger.error(
          { ...jobMeta(job), publicationId, tg: meta.text },
          'sendPublication: temporary error -> retry via throw',
        );

        await this.contestPublicationService.bumpPublicationError(
          publicationId,
          meta.text,
        );
        throw e;
      }
    }

    if (job.name === 'postResults') {
      await this.postResults(job);
      return;
    }

    if (job.name === 'updateFinishedButton') {
      const { publicationId } = job.data;

      this.logger.debug(
        { ...jobMeta(job), publicationId },
        'updateFinishedButton: start',
      );

      const pub =
        await this.contestPublicationService.getPublicationForButtonUpdate(
          publicationId,
        );

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

      const isFinished = await this.contestLifecycleService.isContestCompleted(
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
            buttonText: 'Конкурс завершён',
            buttonUrl: `${this.configService.get<string>('MINI_APP_URL')}?startapp=${pub.chatId}_${pub.contestId}`,
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
          await this.contestPublicationService.bumpPublicationError(
            publicationId,
            meta.text,
          );
          return;
        }

        if (
          meta.code === 429 &&
          typeof meta.retryAfterSec === 'number' &&
          meta.retryAfterSec > 0
        ) {
          await this.contestPublicationService.bumpPublicationError(
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

        await this.contestPublicationService.bumpPublicationError(
          publicationId,
          meta.text,
        );
        throw e;
      }
    }
  }

  /**
   * Пост с итогами ответом на пост конкурса (дубль исключён jobId
   * publication:<id>:results). Шапка и картинка — из настроек конкурса.
   * Цепочка при 400: обычные эмодзи → стандартный текст → без картинки.
   * Отступили от настроек — пишем админам. 403/прочие 400 → лог, пропуск.
   */
  private async postResults(job: Job<{ publicationId: number }>) {
    const { publicationId } = job.data;
    const pub =
      await this.contestPublicationService.getPublicationForButtonUpdate(
        publicationId,
      );
    if (!pub || typeof pub.telegramMessageId !== 'number') {
      this.logger.warn(
        { ...jobMeta(job), publicationId },
        'postResults: нет публикации или messageId -> skip',
      );
      return;
    }
    const contest = await this.contestRepo.findByParams({ id: pub.contestId });
    if (!contest) return;

    const winners = (
      await this.contestWinnerService.getContestWinners(pub.contestId)
    ).map((w) => ({
      place: w.place,
      username: w.user?.username ?? w.displayUsername ?? null,
    }));
    if (!winners.length) return;

    const problems: string[] = [];
    const photoPath = this.resolveResultsPhoto(contest, problems);
    const headerText = contest.resultsText?.trim() || null;

    // Попытки по убыванию «как задумал админ»
    const attempts = [
      { useCustomEmoji: true, headerText, photoPath },
      { useCustomEmoji: false, headerText, photoPath },
      ...(headerText
        ? [{ useCustomEmoji: false, headerText: null, photoPath }]
        : []),
      ...(photoPath
        ? [{ useCustomEmoji: false, headerText: null, photoPath: undefined }]
        : []),
    ];

    try {
      for (let i = 0; i < attempts.length; i++) {
        const a = attempts[i];
        try {
          await telegramLimiter.schedule(() =>
            this.telegramService.sendContestResults({
              chatId: String(pub.chatId),
              replyToMessageId: pub.telegramMessageId!,
              text: buildContestResultsPost(winners, {
                useCustomEmoji: a.useCustomEmoji,
                headerText: a.headerText,
                withPhoto: !!a.photoPath,
              }),
              buttonText: 'Проверить результаты',
              buttonUrl: `${this.configService.get<string>('MINI_APP_URL')}?startapp=${pub.chatId}_${pub.contestId}`,
              buttonEmojiId: a.useCustomEmoji
                ? RESULTS_EMOJI.cup.id
                : undefined,
              photoPath: a.photoPath,
            }),
          );
          if (headerText && !a.headerText) {
            problems.push(
              'ваш текст итогов не принят Telegram (проверьте HTML-разметку) — отправлен стандартный',
            );
          }
          if (photoPath && !a.photoPath) {
            problems.push(
              'картинка итогов не принята Telegram — отправлено без картинки',
            );
          }
          break;
        } catch (e: any) {
          const meta = formatTelegramError(e);
          if (meta.code !== 400 || i === attempts.length - 1) throw e;
          this.logger.warn(
            { ...jobMeta(job), publicationId, attempt: i, tg: meta.text },
            'postResults: 400 -> следующая попытка',
          );
        }
      }
      this.logger.log(
        { ...jobMeta(job), publicationId, contestId: pub.contestId, problems },
        'postResults: итоги опубликованы',
      );
    } catch (e: any) {
      const meta = formatTelegramError(e);
      // 400/403 — бота убрали из канала, канал удалён: повтор не поможет.
      if (meta.code === 400 || meta.code === 403) {
        this.logger.warn(
          { ...jobMeta(job), publicationId, tg: meta.text },
          'postResults: permanent telegram error -> skip',
        );
        problems.push(`итоги не отправлены: ${meta.text}`);
        await this.notifyAdminsAboutResults(contest, pub.chatId, problems);
        return;
      }
      throw e; // 429 и сетевые — повторит BullMQ (attempts + backoff)
    }

    await this.notifyAdminsAboutResults(contest, pub.chatId, problems);
  }

  /** Абсолютный путь к картинке итогов по настройкам конкурса или undefined. */
  private resolveResultsPhoto(contest: Contest, problems: string[]) {
    const path =
      contest.resultsImageMode === ResultsImageMode.CUSTOM
        ? contest.resultsImagePath
        : contest.resultsImageMode === ResultsImageMode.CONTEST
          ? contest.imagePath
          : null;
    if (!path || path.endsWith('/undefined')) return undefined;
    const absolute = join(process.cwd(), path);
    if (!existsSync(absolute)) {
      problems.push('файл картинки итогов не найден — отправлено без картинки');
      return undefined;
    }
    return absolute;
  }

  private async notifyAdminsAboutResults(
    contest: Contest,
    chatId: number,
    problems: string[],
  ) {
    if (!problems.length) return;
    const text =
      `⚠️ Итоги конкурса «${contest.name}» (id ${contest.id}, чат ${chatId}):\n` +
      problems.map((p) => `• ${p}`).join('\n');
    for (const admin of getAdminTelegramIdsFromEnv()) {
      try {
        // sendMailingMessage — HTML; в названии конкурса бывают < & >
        await this.telegramService.sendMailingMessage({
          chatId: admin,
          text: text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;'),
        });
      } catch (err) {
        this.logger.error(
          { err, adminTelegramId: admin, contestId: contest.id },
          'postResults: не удалось уведомить админа',
        );
      }
    }
  }
}
