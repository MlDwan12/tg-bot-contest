import { Injectable } from '@nestjs/common';
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
    timeZone: 'Europe/Moscow',
  })
  async deleteExpiredMessages(): Promise<void> {
    if (this.isCleanupRunning) {
      this.logger.warn(
        'Очистка сообщений уже выполняется, новый запуск пропущен',
      );
      return;
    }

    this.isCleanupRunning = true;

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
            `Удаление сообщений завершено. Обработано=${totalProcessed}, удалено=${totalDeleted}, failed=${totalFailed}`,
          );
          break;
        }

        this.logger.log(
          `Осталось сообщений для удаления: ${totalLeft}. Беру пачку ${batchSize}`,
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
            `Удаление сообщений завершено. Обработано=${totalProcessed}, удалено=${totalDeleted}, failed=${totalFailed}`,
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

        this.logger.log(
          `Пачка обработана. Обработано=${totalProcessed}, удалено=${totalDeleted}, failed=${totalFailed}`,
        );

        if (messages.length < batchSize) {
          this.logger.log(
            `Удаление сообщений завершено. Обработано=${totalProcessed}, удалено=${totalDeleted}, failed=${totalFailed}`,
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
    timeZone: 'Europe/Moscow',
  })
  async cleanupFailedMessages(): Promise<void> {
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

      this.logger.log(
        `Очистка failed сообщений: удалено ${result.affected ?? 0}, всего ${totalDeleted}`,
      );

      if (rows.length < batchSize) {
        break;
      }
    }

    this.logger.log(
      `Очистка failed сообщений завершена. Всего удалено: ${totalDeleted}`,
    );
  }
}
