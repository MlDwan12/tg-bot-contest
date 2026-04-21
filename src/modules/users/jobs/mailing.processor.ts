import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { TelegramService } from 'src/modules/bot/bot.service';
import { Repository } from 'typeorm';
import { MailingMessageEntity } from '../entities/mailing-message.entity';
import { InjectRepository } from '@nestjs/typeorm';

export interface MailingJobData {
  jobId: string;
  telegramId: string;
  userId: number;
  text?: string;
  imagePath?: string;
  buttonText?: string;
  buttonUrl?: string;
}

@Processor('user-mailing')
export class MailingProcessor extends WorkerHost {
  constructor(
    private readonly telegramService: TelegramService,
    private readonly logger: Logger,
    @InjectRepository(MailingMessageEntity)
    private readonly mailingMessageRepo: Repository<MailingMessageEntity>,
  ) {
    super();
  }

  async process(job: Job<MailingJobData>): Promise<void> {
    const {
      telegramId,
      userId,
      text,
      imagePath,
      buttonText,
      buttonUrl,
      jobId,
    } = job.data;

    try {
      this.logger.debug({ jobId, userId, telegramId }, 'mailing: sending');

      const sentMessage = await this.telegramService.sendMailingMessage({
        chatId: telegramId,
        text,
        imagePath,
        buttonText,
        buttonUrl,
      });

      await this.mailingMessageRepo.save({
        mailingJobId: jobId,
        userId,
        telegramId,
        chatId: String(sentMessage.chatId),
        messageId: sentMessage.messageId,
        text: text ?? null,
        imagePath: imagePath ?? null,
        deleteStatus: 'pending',
        deleteAfter: new Date(Date.now() + 60 * 1000),
        // deleteAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
        deleteError: null,
        deletedAt: null,
        sentAt: new Date(),
      });

      this.logger.debug(
        {
          jobId,
          userId,
          telegramId,
          messageId: sentMessage.messageId,
        },
        'mailing: sent and saved',
      );
    } catch (error) {
      this.logger.error(
        {
          jobId,
          userId,
          telegramId,
          err: error,
        },
        'mailing: failed',
      );
      throw error;
    }
  }
}
