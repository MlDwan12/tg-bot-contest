import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { Logger } from 'nestjs-pino';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { getAdminTelegramIdsFromEnv } from 'src/common/helpers/admin-ids.helper';
import { TelegramService } from 'src/modules/bot/bot.service';
import { MailingJobEntity } from '../entities/mailing-jobs.entity';

const MOSCOW_TZ = 'Europe/Moscow';
const SEND_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 10000;

export interface MailingStatsPayload {
  date: string;
  delivered: number;
  blocked: number;
  errors: number;
}

// date — день СТАРТА рассылки по МСК, а не день отправки отчёта.
export function buildMailingStatsPayload(
  job: MailingJobEntity,
): MailingStatsPayload {
  return {
    date: formatInTimeZone(job.startedAt ?? job.createdAt, MOSCOW_TZ, 'yyyy-MM-dd'),
    delivered: job.sentCount,
    blocked: job.blockedCount,
    errors: job.errorCount,
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function startOfTodayMoscow(now: Date = new Date()): Date {
  const zoned = toZonedTime(now, MOSCOW_TZ);
  return fromZonedTime(
    new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate()),
    MOSCOW_TZ,
  );
}

/**
 * Отправляет статистику завершённых рассылок во внешний API. Вызывается
 * кроном удаления (MailingCleanupService), после прохода удаления.
 *
 * Берёт рассылки, стартовавшие до сегодняшнего дня по МСК (их сообщения
 * удаляются на следующий день), без statsReportedAt. Не получилось — пинг
 * админам в личку, statsReportedAt остаётся null, следующий крон повторит.
 * Внешний API перезаписывает запись по дате, так что повтор безопасен.
 */
@Injectable()
export class MailingStatsReporterService {
  constructor(
    @InjectRepository(MailingJobEntity)
    private readonly mailingJobRepo: Repository<MailingJobEntity>,
    private readonly configService: ConfigService,
    private readonly telegramService: TelegramService,
    private readonly logger: Logger,
  ) {}

  async reportPending(): Promise<void> {
    const url = this.configService.get<string>('MAILING_STATS_URL');
    const apiKey = this.configService.get<string>('MAILING_STATS_API_KEY');

    if (!url || !apiKey) {
      this.logger.warn(
        'mailing-stats: MAILING_STATS_URL/MAILING_STATS_API_KEY не заданы, отчёт не отправляется',
      );
      return;
    }

    const types = this.configService
      .get<string>('MAILING_STATS_TYPES', 'ALL')
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean);

    try {
      const jobs = await this.mailingJobRepo.find({
        where: {
          type: In(types),
          status: In(['pending', 'processing', 'completed', 'completed_with_errors']),
          statsReportedAt: IsNull(),
          startedAt: LessThan(startOfTodayMoscow()),
        },
        order: { startedAt: 'ASC' },
      });

      for (const job of jobs) {
        if (job.status === 'pending' || job.status === 'processing') {
          await this.notifyStuck(job);
        } else {
          await this.reportJob(job, url, apiKey);
        }
      }
    } catch (error: any) {
      this.logger.error({ err: error }, 'mailing-stats: ошибка');
    }
  }

  private async reportJob(
    job: MailingJobEntity,
    url: string,
    apiKey: string,
  ): Promise<void> {
    const payload = buildMailingStatsPayload(job);
    let lastError = '';

    for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (response.ok) {
          await this.mailingJobRepo.update(
            { id: job.id },
            { statsReportedAt: new Date() },
          );
          this.logger.log({ jobId: job.id, payload }, 'mailing-stats: отправлено');
          await this.notifyAdmins(
            [
              '✅ Статистика рассылки отправлена во внешний API',
              `Рассылка: ${job.id}`,
              `Дата: ${payload.date}`,
              `Доставлено: ${payload.delivered}, заблокировано: ${payload.blocked}, ошибки: ${payload.errors}`,
            ].join('\n'),
          );
          return;
        }

        lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`;
      } catch (error: any) {
        lastError = error?.message || String(error);
      }

      this.logger.warn(
        { jobId: job.id, attempt, error: lastError },
        'mailing-stats: попытка не удалась',
      );

      if (attempt < SEND_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    this.logger.error(
      { jobId: job.id, payload, error: lastError },
      'mailing-stats: не удалось отправить, повтор на следующем кроне',
    );
    await this.notifyAdmins(
      [
        '⚠️ Не удалось отправить статистику рассылки во внешний API',
        `Рассылка: ${job.id}`,
        `Дата: ${payload.date}`,
        `Доставлено: ${payload.delivered}, заблокировано: ${payload.blocked}, ошибки: ${payload.errors}`,
        // sendMailingMessage шлёт с parse_mode HTML, а ngrok в ошибке
        // отдаёт HTML-страницу — без экранирования Telegram не примет пинг.
        `Ошибка: ${escapeHtml(lastError)}`,
        'Повтор — на следующем кроне удаления (14:00 МСК).',
      ].join('\n'),
    );
  }

  // Рассылка стартовала до сегодняшнего дня и так и не завершилась (упал
  // воркер, потерялись задачи) — счётчики неполные, отчёт не шлём. Пинг
  // повторяется на каждом кроне, пока статус не поменяют руками.
  private async notifyStuck(job: MailingJobEntity): Promise<void> {
    const payload = buildMailingStatsPayload(job);

    this.logger.warn(
      { jobId: job.id, status: job.status, payload },
      'mailing-stats: рассылка зависла, отчёт не отправлен',
    );
    await this.notifyAdmins(
      [
        '⚠️ Рассылка не завершилась — статистика НЕ отправлена',
        `Рассылка: ${job.id}`,
        `Дата: ${payload.date}, статус: ${job.status}`,
        `В очереди: ${job.queuedCount}, доставлено: ${payload.delivered}, заблокировано: ${payload.blocked}, ошибки: ${payload.errors}`,
        'Пинг повторится на следующем кроне (14:00 МСК).',
      ].join('\n'),
    );
  }

  private async notifyAdmins(text: string): Promise<void> {
    for (const admin of getAdminTelegramIdsFromEnv()) {
      try {
        await this.telegramService.sendMailingMessage({ chatId: admin, text });
      } catch (error: any) {
        this.logger.error(
          { err: error, adminTelegramId: admin },
          'mailing-stats: не удалось уведомить админа',
        );
      }
    }
  }
}
