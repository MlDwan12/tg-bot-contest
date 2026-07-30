import { Injectable } from '@nestjs/common';
import { getAppTimeZone } from 'src/common/helpers/app-timezone.helper';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  MoreThan,
  Repository,
} from 'typeorm';
import { Logger } from 'nestjs-pino';
import { TelegramService } from 'src/modules/bot/bot.service';
import { MailingMessageEntity } from '../entities/mailing-message.entity';

@Injectable()
export class MailingCleanupService {
  private isCleanupRunning = false;

  constructor(
    @InjectRepository(MailingMessageEntity)
    private readonly mailingMessageRepo: Repository<MailingMessageEntity>,
    private readonly telegramService: TelegramService,
    private readonly logger: Logger,
  ) {}

  @Cron('0 14 * * *', {
    timeZone: getAppTimeZone(),
  })
  async deleteExpiredMessages(): Promise<void> {
    if (this.isCleanupRunning) {
      this.logger.warn(
        'Очистка сообщений уже выполняется, новый запуск пропущен',
      );
      return;
    }

    this.isCleanupRunning = true;
    const cleanupStart = Date.now();
    this.logger.log('cleanup:deleteExpiredMessages: started');

    const batchSize = 100;
    let totalProcessed = 0;
    let totalDeleted = 0;
    let totalFailed = 0;

    try {
      while (true) {
        const now = new Date();

        await this.mailingMessageRepo.update(
          {
            deleteStatus: In(['pending', 'failed']),
            deletedAt: IsNull(),
            deleteAfter: LessThanOrEqual(now),
            messageId: 0,
          },
          {
            deleteStatus: 'failed',
            deleteError: 'Некорректный messageId: 0',
          },
        );

        const totalLeft = await this.mailingMessageRepo.count({
          where: {
            deleteStatus: In(['pending', 'failed']),
            deletedAt: IsNull(),
            deleteAfter: LessThanOrEqual(now),
            messageId: MoreThan(0),
          },
        });

        if (totalLeft === 0) {
          this.logger.log(
            {
              totalProcessed,
              totalDeleted,
              totalFailed,
              durationSec: Math.round((Date.now() - cleanupStart) / 1000),
            },
            'cleanup:deleteExpiredMessages: done',
          );
          break;
        }

        this.logger.debug(
          { totalLeft, batchSize },
          'deleteExpiredMessages: fetching next batch',
        );

        const messages = await this.mailingMessageRepo.find({
          where: {
            deleteStatus: In(['pending', 'failed']),
            deletedAt: IsNull(),
            deleteAfter: LessThanOrEqual(now),
            messageId: MoreThan(0),
          },
          take: batchSize,
          order: {
            deleteAfter: 'ASC',
            id: 'ASC',
          },
        });

        if (!messages.length) {
          this.logger.log(
            {
              totalProcessed,
              totalDeleted,
              totalFailed,
              durationSec: Math.round((Date.now() - cleanupStart) / 1000),
            },
            'cleanup:deleteExpiredMessages: done',
          );
          break;
        }

        for (const msg of messages) {
          try {
            await this.telegramService.deleteMessage(msg.chatId, msg.messageId);

            // msg.deleteStatus = 'deleted';
            // msg.deletedAt = new Date();
            // msg.deleteError = null;
            await this.mailingMessageRepo.delete(msg.id);

            totalDeleted++;

            this.logger.debug(
              {
                id: msg.id,
                chatId: msg.chatId,
                messageId: msg.messageId,
              },
              'Сообщение удалено',
            );
          } catch (error: any) {
            const errorMessage = error?.message || String(error);

            msg.deleteStatus = 'failed';
            msg.deleteError = errorMessage;

            await this.mailingMessageRepo.save(msg);

            totalFailed++;

            this.logger.warn(
              {
                id: msg.id,
                chatId: msg.chatId,
                messageId: msg.messageId,
                error: msg.deleteError,
              },
              'Ошибка при удалении сообщения',
            );
          }
          totalProcessed++;
        }

        this.logger.debug(
          { totalProcessed, totalDeleted, totalFailed },
          'deleteExpiredMessages: batch done',
        );

        if (messages.length < batchSize) {
          this.logger.log(
            {
              totalProcessed,
              totalDeleted,
              totalFailed,
              durationSec: Math.round((Date.now() - cleanupStart) / 1000),
            },
            'cleanup:deleteExpiredMessages: done',
          );
          break;
        }
      }
    } catch (error: any) {
      this.logger.error(
        {
          error: error?.message || String(error),
          totalProcessed,
          totalDeleted,
          totalFailed,
        },
        'Ошибка во время очистки сообщений',
      );
    } finally {
      this.isCleanupRunning = false;
    }
  }

  @Cron('0 3 * * 5', {
    timeZone: getAppTimeZone(),
  })
  async cleanupFailedMessages(): Promise<void> {
    const cleanupStart = Date.now();
    this.logger.log('cleanup:cleanupFailedMessages: started');

    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - 2);

    const batchSize = 1000;
    let totalDeleted = 0;

    while (true) {
      const rows = await this.mailingMessageRepo.find({
        select: ['id'],
        where: {
          deleteStatus: 'failed',
          deleteAfter: LessThan(thresholdDate),
        },
        take: batchSize,
        order: {
          id: 'ASC',
        },
      });

      if (!rows.length) {
        break;
      }

      const ids = rows.map((row) => row.id);

      const result = await this.mailingMessageRepo.delete(ids);
      totalDeleted += result.affected ?? 0;

      this.logger.debug(
        { deletedInBatch: result.affected ?? 0, totalDeleted },
        'cleanupFailedMessages: batch deleted',
      );

      if (rows.length < batchSize) {
        break;
      }
    }

    this.logger.log(
      {
        totalDeleted,
        durationSec: Math.round((Date.now() - cleanupStart) / 1000),
      },
      'cleanup:cleanupFailedMessages: done',
    );
  }
}
