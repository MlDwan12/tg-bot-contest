import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { TelegramService } from 'src/modules/bot/bot.service';

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

    this.logger.debug({ jobId, userId, telegramId }, 'mailing: sending');

    await this.telegramService.sendMailingMessage({
      chatId: telegramId,
      text,
      imagePath,
      buttonText,
      buttonUrl,
    });
  }
}
