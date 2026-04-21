import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { TelegramService } from 'src/modules/bot/bot.service';
import { MailingMessageEntity } from '../entities/mailing-message.entity';

@Injectable()
export class MailingCleanupService {
  constructor(
    @InjectRepository(MailingMessageEntity)
    private readonly mailingMessageRepo: Repository<MailingMessageEntity>,
    private readonly telegramService: TelegramService,
    private readonly logger: Logger,
  ) {}

  @Cron('0 0 14 * * *', {
    timeZone: 'Europe/Moscow',
  })
  async deleteExpiredMessages(): Promise<void> {
    const now = new Date();

    const messages = await this.mailingMessageRepo.find({
      where: {
        deleteStatus: 'pending',
        deleteAfter: LessThanOrEqual(now),
      },
      take: 100,
      order: {
        deleteAfter: 'ASC',
      },
    });

    if (!messages.length) {
      return;
    }

    this.logger.log(`Удаление сообщений: найдено ${messages.length}`);

    for (const msg of messages) {
      try {
        await this.telegramService.deleteMessage(msg.chatId, msg.messageId);

        msg.deleteStatus = 'deleted';
        msg.deletedAt = new Date();
        msg.deleteError = null;

        this.logger.debug(
          {
            id: msg.id,
            chatId: msg.chatId,
            messageId: msg.messageId,
          },
          'Сообщение удалено',
        );
      } catch (error: any) {
        msg.deleteStatus = 'failed';
        msg.deleteError = error?.message || String(error);

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

      await this.mailingMessageRepo.save(msg);
    }
  }
}
