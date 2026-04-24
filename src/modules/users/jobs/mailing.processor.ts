import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { TelegramService } from 'src/modules/bot/bot.service';
import { DataSource, Repository } from 'typeorm';
import { MailingMessageEntity } from '../entities/mailing-message.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { MailingJobEntity } from '../entities/mailing-jobs.entity';
import { UsersMailingService } from '../services/users-mailing.service';

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
    private readonly dataSource: DataSource,
    private readonly telegramService: TelegramService,
    private readonly logger: Logger,
    @InjectRepository(MailingMessageEntity)
    private readonly mailingMessageRepo: Repository<MailingMessageEntity>,
    @InjectRepository(MailingJobEntity)
    private readonly mailingJobRepo: Repository<MailingJobEntity>,
    private readonly usersMailingService: UsersMailingService,
  ) {
    super();
  }

  // async process(job: Job<MailingJobData>): Promise<void> {
  //   const {
  //     telegramId,
  //     userId,
  //     text,
  //     imagePath,
  //     buttonText,
  //     buttonUrl,
  //     jobId,
  //   } = job.data;

  //   try {
  //     this.logger.debug({ jobId, userId, telegramId }, 'mailing: sending');

  //     const sentMessage = await this.telegramService.sendMailingMessage({
  //       chatId: telegramId,
  //       text,
  //       imagePath,
  //       buttonText,
  //       buttonUrl,
  //     });

  //     await this.mailingMessageRepo.save({
  //       mailingJobId: jobId,
  //       userId,
  //       telegramId,
  //       chatId: String(sentMessage.chatId),
  //       messageId: sentMessage.messageId,
  //       text: text ?? null,
  //       imagePath: imagePath ?? null,
  //       deleteStatus: 'pending',
  //       deleteAfter: new Date(Date.now() + 60 * 1000),
  //       // deleteAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
  //       deleteError: null,
  //       deletedAt: null,
  //       sentAt: new Date(),
  //     });

  //     this.logger.debug(
  //       {
  //         jobId,
  //         userId,
  //         telegramId,
  //         messageId: sentMessage.messageId,
  //       },
  //       'mailing: sent and saved',
  //     );
  //   } catch (error) {
  //     this.logger.error(
  //       {
  //         jobId,
  //         userId,
  //         telegramId,
  //         err: error,
  //       },
  //       'mailing: failed',
  //     );
  //     throw error;
  //   }
  // }

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

      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(MailingMessageEntity).save({
          mailingJobId: jobId,
          userId,
          telegramId,
          chatId: String(sentMessage.chatId),
          messageId: sentMessage.messageId,
          text: text ?? null,
          imagePath: imagePath ?? null,
          sendStatus: 'sent',
          sendError: null,
          deleteStatus: 'pending',
          deleteAfter: new Date(Date.now() + 60 * 1000),
          deleteError: null,
          deletedAt: null,
          sentAt: new Date(),
        });

        await manager.increment(
          MailingJobEntity,
          { id: jobId },
          'sentCount',
          1,
        );
      });

      await this.tryFinalizeJob(jobId);

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
      const errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);

      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(MailingMessageEntity).save({
          mailingJobId: jobId,
          userId,
          telegramId,
          chatId: telegramId,
          messageId: 0,
          text: text ?? null,
          imagePath: imagePath ?? null,
          sendStatus: 'failed',
          sendError: errorMessage,
          deleteStatus: 'failed',
          deleteAfter: new Date(),
          deleteError: null,
          deletedAt: null,
          sentAt: new Date(),
        });

        await manager.increment(
          MailingJobEntity,
          { id: jobId },
          'failedCount',
          1,
        );
      });

      await this.tryFinalizeJob(jobId);

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

  private async tryFinalizeJob(jobId: string): Promise<void> {
    const job = await this.mailingJobRepo.findOne({ where: { id: jobId } });
    if (!job) return;

    const processed = job.sentCount + job.failedCount;

    if (processed < job.queuedCount) {
      return;
    }

    const finalStatus =
      job.failedCount > 0 ? 'completed_with_errors' : 'completed';

    const updateResult = await this.mailingJobRepo.update(
      { id: jobId, status: 'processing' },
      {
        status: finalStatus,
        finishedAt: new Date(),
      },
    );

    if (!updateResult.affected) {
      return;
    }

    await this.usersMailingService.notifyAdminsAboutMailingFinishByJobId(jobId);
  }
}
