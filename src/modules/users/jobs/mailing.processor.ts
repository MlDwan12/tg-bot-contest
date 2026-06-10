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

    // Защита от повторной отправки при retry.
    //
    // Сценарий без этой проверки:
    //   1. sendMailingMessage отправил сообщение в Telegram ✓
    //   2. dataSource.transaction упала (краш, таймаут БД) ✗
    //   3. BullMQ помечает job как failed → retry
    //   4. Пользователь получает то же письмо второй раз
    //
    // BullMQ никогда не запускает один job параллельно, поэтому race condition
    // между двумя воркерами для одного job здесь невозможен — только retry.
    const alreadySent = await this.mailingMessageRepo.existsBy({
      mailingJobId: jobId,
      userId,
      sendStatus: 'sent',
    });

    if (alreadySent) {
      this.logger.warn(
        { jobId, userId },
        'mailing: письмо уже отправлено в предыдущей попытке, пропускаем retry',
      );
      return;
    }

    const alreadyFailed = await this.mailingMessageRepo.existsBy({
      mailingJobId: jobId,
      userId,
      sendStatus: 'failed',
    });

    if (alreadyFailed) {
      this.logger.warn(
        { jobId, userId },
        'mailing: предыдущая попытка уже записана как failed, пропускаем повторный retry',
      );
      return;
    }

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
    // Атомарный подход: читаем счётчики и меняем статус в одном SQL-запросе.
    //
    // Проблема с предыдущим подходом (SELECT + UPDATE):
    //   1. Worker A и Worker B оба вызывают tryFinalizeJob
    //   2. Оба читают sentCount = 1000, queuedCount = 1000 → оба "последние"
    //   3. Только один UPDATE проходит (условие status='processing')
    //   4. Но до UPDATE оба уже могли принять решение об уведомлении
    //
    // Здесь WHERE содержит ВСЕ условия: статус, счётчик — всё проверяется
    // и изменяется атомарно на уровне одной строки PostgreSQL.
    // Если affected = 0 — либо статус уже не 'processing', либо счётчики
    // ещё не дошли до queuedCount. В обоих случаях правильно ничего не делать.
    const result = await this.mailingJobRepo
      .createQueryBuilder()
      .update(MailingJobEntity)
      .set({
        status: () =>
          `CASE WHEN "failedCount" > 0 THEN 'completed_with_errors' ELSE 'completed' END`,
        finishedAt: () => 'NOW()',
      })
      .where('"id" = :id', { id: jobId })
      .andWhere('"status" = :status', { status: 'processing' })
      .andWhere('("sentCount" + "failedCount") >= "queuedCount"')
      .execute();

    if (!result.affected) return;

    await this.usersMailingService.notifyAdminsAboutMailingFinishByJobId(jobId);
  }
}
