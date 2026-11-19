import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ContestParticipation } from 'src/modules/contests/entities/contest-participation.entity';
import { UserRole } from 'src/common/enums/user';
import { User } from '../entities';
import { SendUsersMailingDto } from '../dto/send-users-mailing.dto';
import { TelegramService } from 'src/modules/bot/bot.service';
import { UserMailingType } from 'src/common/enums/user/user-mailing-type.enum';
import { ContestPublicationService } from '../../contests/services/contest-publication.service';
import { Logger } from 'nestjs-pino';
import { ContestPublication } from 'src/modules/contests/entities';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MailingJobEntity } from '../entities/mailing-jobs.entity';
import { getAdminTelegramIdsFromEnv } from 'src/common/helpers/admin-ids.helper';
import { getNextDayMoscowDeleteDate } from 'src/common/helpers/mailing-delete-date.helper';
import {
  MAILING_PROGRESS_WIDGET_HTML,
  MailingProgressData,
} from '../widgets/mailing-progress.widget';

// Не чаще раза в 5 с: клиенты всё равно опрашивают виджет не чаще (cache_time ≥ 5),
// а Telegram пускает правку общего виджета не чаще раза в секунду.
const PROGRESS_THROTTLE_MS = 5000;

@Injectable()
export class UsersMailingService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(ContestParticipation)
    private readonly participationRepository: Repository<ContestParticipation>,
    @InjectRepository(MailingJobEntity)
    private readonly mailingJobRepo: Repository<MailingJobEntity>,
    @InjectQueue('user-mailing')
    private readonly mailingQueue: Queue,
    private readonly telegramService: TelegramService,
    private readonly contestPublicationService: ContestPublicationService,
    private readonly logger: Logger,
  ) {}

  async sendMailing(
    dto: SendUsersMailingDto,
    image?: Express.Multer.File,
  ): Promise<{ jobId: string; enqueuedCount: number }> {
    this.logger.log(
      `Запуск рассылки: type=${dto.type}, userId=${dto.userId ?? '-'}, groupId=${dto.groupId ?? '-'}, contestId=${dto.contestId ?? '-'}, hasButton=${!!dto.buttonText}, hasImage=${!!image}`,
    );

    this.validateButton(dto);

    const users = await this.getRecipients(dto);

    const publication = dto.contestId
      ? await this.contestPublicationService.getPublicationByContestId(
          dto.contestId,
        )
      : undefined;

    this.logger.log(`Получено пользователей для рассылки: ${users.length}`);

    const imagePath = image ? `/uploads/mailings/${image.filename}` : undefined;
    const finalButtonUrl = this.resolveButtonUrl(dto, publication);
    const text = dto.text || publication?.payload?.text;
    const finalImagePath = imagePath || publication?.payload?.photoUrl;
    // Кнопка ведёт на пост, а не в мини-апп — «Участвовать» из поста тут
    // вводило бы в заблуждение (участие засчитывается только из поста).
    const buttonText =
      dto.buttonText || (publication ? 'Перейти к конкурсу' : undefined);

    const jobId = `mailing-${Date.now()}`;

    const recipientsWithTelegram = users.filter((user) => !!user.telegramId);
    const skippedCount = users.length - recipientsWithTelegram.length;

    await this.mailingJobRepo.save({
      id: jobId,
      type: dto.type,
      initiatorUserId: dto.userId != null ? String(dto.userId) : null,
      contestId: dto.contestId ?? null,
      groupId: dto.groupId ? String(dto.groupId) : null,
      totalRecipients: users.length,
      queuedCount: recipientsWithTelegram.length,
      skippedCount,
      sentCount: 0,
      failedCount: 0,
      deletedCount: 0,
      deleteFailedCount: 0,
      deleteAfter: getNextDayMoscowDeleteDate(),
      deletedAt: null,
      status: 'processing',
      text: text ?? null,
      imagePath: finalImagePath ?? null,
      buttonText: buttonText ?? null,
      buttonUrl: finalButtonUrl ?? null,
      startedAt: new Date(),
      finishedAt: null,
      error: null,
    });

    await this.notifyAdminsAboutMailingStart(dto, image, users.length, {
      id: jobId,
      queuedCount: recipientsWithTelegram.length,
      skippedCount,
    });

    try {
      await this.mailingQueue.addBulk(
        users
          .filter((user) => !!user.telegramId)
          .map((user) => ({
            name: 'send-message',
            data: {
              jobId,
              telegramId: user.telegramId,
              userId: user.id,
              text: dto.text || publication?.payload?.text,
              imagePath: finalImagePath,
              buttonText,
              buttonUrl: finalButtonUrl,
            },
          })),
      );
    } catch (error) {
      await this.mailingJobRepo.update(
        { id: jobId },
        { status: 'failed', error: String(error), finishedAt: new Date() },
      );
      throw error;
    }

    this.logger.log(
      {
        jobId,
        type: dto.type,
        queuedCount: recipientsWithTelegram.length,
        skippedCount,
        totalRecipients: users.length,
      },
      'mailing: queued',
    );

    return { jobId, enqueuedCount: recipientsWithTelegram.length };
  }

  private validateButton(dto: SendUsersMailingDto): void {
    if (dto.buttonText && !dto.buttonUrl && !dto.contestId) {
      throw new BadRequestException(
        'Either buttonUrl or contestId is required when buttonText is provided',
      );
    }

    if (dto.buttonUrl && !dto.buttonText) {
      throw new BadRequestException(
        'buttonText is required when buttonUrl or contestId is provided',
      );
    }
  }

  private resolveButtonUrl(
    dto: SendUsersMailingDto,
    publication?: ContestPublication,
  ): string | undefined {
    if (dto.contestId) {
      this.logger.debug(
        { contestId: dto.contestId },
        'resolveButtonUrl: building URL from contestId',
      );

      // const publication = await this.contestPublicationService.getPublicationByContestId(
      //   dto.contestId,
      // );

      if (!publication) {
        this.logger.warn(
          { contestId: dto.contestId },
          'resolveButtonUrl: публикация конкурса не найдена',
        );
        throw new NotFoundException('Contest publication not found');
      }

      this.logger.debug(
        {
          publicationId: publication.id,
          telegramMessageId: publication.telegramMessageId,
          chatId: publication.chatId,
        },
        'resolveButtonUrl: publication found',
      );

      const postUrl = this.buildTelegramPostUrl({
        telegramUsername: publication.channel?.telegramUsername,
        telegramId:
          publication.channel?.telegramId ?? String(publication.chatId),
        messageId: publication.telegramMessageId!,
      });

      this.logger.debug({ postUrl }, 'resolveButtonUrl: URL built');

      return postUrl;
    }

    if (dto.buttonUrl) {
      this.logger.debug(
        { buttonUrl: dto.buttonUrl },
        'resolveButtonUrl: using provided buttonUrl',
      );
    }

    return dto.buttonUrl;
  }

  private buildTelegramPostUrl(params: {
    telegramUsername?: string;
    telegramId?: string | number;
    messageId: number;
  }): string {
    const { telegramUsername, telegramId, messageId } = params;

    const telegramIdStr =
      telegramId !== undefined && telegramId !== null
        ? String(telegramId)
        : undefined;

    this.logger.debug(
      { telegramUsername, telegramId: telegramIdStr, messageId },
      'buildTelegramPostUrl: building',
    );

    if (!messageId) {
      this.logger.warn(
        { telegramId: telegramIdStr },
        'buildTelegramPostUrl: отсутствует messageId',
      );
      throw new BadRequestException('Publication messageId is missing');
    }

    if (telegramUsername) {
      const url = `https://t.me/${telegramUsername}/${messageId}`;
      this.logger.debug({ url }, 'buildTelegramPostUrl: public post URL');
      return url;
    }

    if (telegramIdStr?.startsWith('-100')) {
      const internalChatId = telegramIdStr.slice(4);
      const url = `https://t.me/c/${internalChatId}/${messageId}`;
      this.logger.debug({ url }, 'buildTelegramPostUrl: private post URL');
      return url;
    }

    this.logger.warn(
      { telegramUsername, telegramId: telegramIdStr },
      'buildTelegramPostUrl: невозможно построить URL',
    );

    throw new BadRequestException(
      'Cannot build Telegram post URL: channel username or valid telegramId is required',
    );
  }

  private async getRecipients(dto: SendUsersMailingDto): Promise<User[]> {
    this.logger.debug({ type: dto.type }, 'getRecipients: fetching');

    switch (dto.type) {
      case UserMailingType.USER: {
        if (!dto.userId) {
          this.logger.warn(
            { type: dto.type },
            'getRecipients: userId не передан',
          );
          throw new BadRequestException(
            'userId is required for USER mailing type',
          );
        }

        const user = await this.usersRepository.findOne({
          where: {
            telegramId: String(dto.userId),
            role: UserRole.USER,
          },
        });

        if (!user) {
          this.logger.warn(
            { telegramId: dto.userId },
            'getRecipients: пользователь не найден',
          );
          throw new NotFoundException('User not found');
        }

        this.logger.debug({ userId: user.id }, 'getRecipients: found user');

        return [user];
      }

      case UserMailingType.GROUP: {
        const participations = await this.participationRepository.find({
          where: {
            groupId: dto.groupId,
          },
          select: {
            userId: true,
          },
        });

        const uniqueUserIds = [...new Set(participations.map((p) => p.userId))];

        this.logger.debug(
          {
            groupId: dto.groupId,
            participations: participations.length,
            uniqueUsers: uniqueUserIds.length,
          },
          'getRecipients: GROUP participations',
        );

        if (!uniqueUserIds.length) {
          this.logger.warn(
            { groupId: dto.groupId },
            'getRecipients: получатели не найдены',
          );
          return [];
        }

        const users = await this.usersRepository.find({
          where: {
            id: In(uniqueUserIds),
            role: UserRole.USER,
          },
        });

        this.logger.debug(
          { count: users.length },
          'getRecipients: GROUP users loaded',
        );

        return users;
      }

      case UserMailingType.ALL: {
        const users = await this.usersRepository.find({
          where: {
            role: UserRole.USER,
          },
        });

        this.logger.debug(
          { count: users.length },
          'getRecipients: ALL users loaded',
        );

        return users;
      }

      default:
        this.logger.warn(
          { type: dto.type },
          'getRecipients: неизвестный тип рассылки',
        );
        return [];
    }
  }

  private async getAdminRecipients(): Promise<User[]> {
    const admins = await this.usersRepository.find({
      where: {
        role: UserRole.ADMIN,
      },
    });

    this.logger.debug({ count: admins.length }, 'getAdminRecipients: found');

    return admins.filter((admin) => !!admin.telegramId);
  }

  private async notifyAdminsAboutMailingStart(
    dto: SendUsersMailingDto,
    image: Express.Multer.File | undefined,
    recipientsCount: number,
    job: { id: string; queuedCount: number; skippedCount: number },
  ): Promise<void> {
    try {
      // const admins = await this.getAdminRecipients();
      const admins = getAdminTelegramIdsFromEnv();

      if (!admins.length) {
        this.logger.warn(
          'Нет админов с telegramId для уведомления о старте рассылки',
        );
        return;
      }

      const text = this.buildMailingStartMessage(dto, image, recipientsCount);

      // Живой виджет прогресса; не вышло (старый клиент API, сбой) — текстом
      if (await this.startProgressWidget(admins, text, job)) return;

      for (const admin of admins) {
        try {
          await this.telegramService.sendMailingMessage({
            chatId: admin,
            text,
          });
        } catch (error: any) {
          this.logger.error(
            { err: error, adminTelegramId: admin },
            'notifyAdminsAboutMailingStart: не удалось отправить уведомление',
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        { err: error },
        'notifyAdminsAboutMailingStart: ошибка',
      );
    }
  }

  private async notifyAdminsAboutMailingFinish(
    mailingJob: MailingJobEntity,
    errors: Array<{ userId: number; telegramId: string; error: string }> = [],
    fatalError?: any,
  ): Promise<void> {
    try {
      // const admins = await this.getAdminRecipients();
      const admins = getAdminTelegramIdsFromEnv();

      if (!admins.length) {
        this.logger.warn(
          'Нет админов с telegramId для уведомления о завершении рассылки',
        );
        return;
      }

      const text = mailingJob.progressWidgetId
        ? await this.finishProgressWidget(mailingJob)
        : this.buildMailingFinishMessage(mailingJob);

      for (const admin of admins) {
        try {
          await this.telegramService.sendMailingMessage({
            chatId: admin,
            text,
          });
        } catch (error: any) {
          this.logger.error(
            { err: error, adminTelegramId: admin },
            'notifyAdminsAboutMailingFinish: не удалось отправить уведомление',
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        { err: error },
        'notifyAdminsAboutMailingFinish: ошибка',
      );
    }
  }
  private buildMailingStartMessage(
    dto: SendUsersMailingDto,
    image: Express.Multer.File | undefined,
    recipientsCount?: number,
  ): string {
    return [
      '🚀 Запущена рассылка',
      '',
      `Тип: ${dto.type}`,
      `Получателей: ${recipientsCount}`,
      `Текст: ${dto.text ?? '-'}`,
      `User ID: ${dto.userId ?? '-'}`,
      `Group ID: ${dto.groupId ?? '-'}`,
      `Contest ID: ${dto.contestId ?? '-'}`,
      `Текст кнопки: ${dto.buttonText ?? '-'}`,
      `Ссылка кнопки: ${dto.buttonUrl ?? '-'}`,
      `Медиа: ${image?.filename ?? 'нет'}`,
    ].join('\n');
  }

  private buildMailingFinishMessage(
    mailingJob: MailingJobEntity,
    extra?: {
      fatalError?: any;
      errors?: Array<{ userId: number; telegramId: string; error: string }>;
    },
  ): string {
    const errors = extra?.errors ?? [];

    const errorLines = errors.length
      ? errors
          .slice(0, 10)
          .map(
            (e, index) =>
              `${index + 1}. userId=${e.userId}, telegramId=${e.telegramId || '-'}, error=${e.error}`,
          )
      : ['нет'];

    return [
      extra?.fatalError
        ? '❌ Рассылка завершена с критической ошибкой'
        : '✅ Рассылка завершена',
      '',
      `Job ID: ${mailingJob.id}`,
      `Статус: ${mailingJob.status}`,
      `Тип: ${mailingJob.type}`,
      `Текст: ${mailingJob.text ?? '-'}`,
      `User ID: ${mailingJob.initiatorUserId ?? '-'}`,
      `Group ID: ${mailingJob.groupId ?? '-'}`,
      `Contest ID: ${mailingJob.contestId ?? '-'}`,
      `Текст кнопки: ${mailingJob.buttonText ?? '-'}`,
      `Ссылка кнопки: ${mailingJob.buttonUrl ?? '-'}`,
      `Медиа: ${mailingJob.imagePath ?? 'нет'}`,
      '',
      `Всего: ${mailingJob.totalRecipients}`,
      `В очереди: ${mailingJob.queuedCount}`,
      `Пропущено: ${mailingJob.skippedCount}`,
      `Успешно: ${mailingJob.sentCount}`,
      `Ошибок отправки: ${mailingJob.failedCount}`,
      `Удалено: ${mailingJob.deletedCount}`,
      `Ошибок удаления: ${mailingJob.deleteFailedCount}`,
      '',
      'Первые ошибки:',
      ...errorLines,
      ...(extra?.fatalError
        ? [
            '',
            `Critical error: ${extra.fatalError?.message ?? 'Unknown error'}`,
          ]
        : []),
    ].join('\n');
  }

  // ponytail: замок прогресса в памяти процесса — API один. Несколько
  // экземпляров API → перенести в Redis (SET NX EX 5).
  private readonly progressTouchedAt = new Map<string, number>();

  private progressData(job: MailingJobEntity): string {
    const data: MailingProgressData = {
      q: job.queuedCount,
      s: job.sentCount,
      b: job.blockedCount,
      e: job.errorCount,
      k: job.skippedCount,
      st: job.status,
      r: Date.now(),
    };
    return JSON.stringify(data);
  }

  /** Общий виджет первому админу, остальным — его копия. false — не вышло. */
  private async startProgressWidget(
    admins: string[],
    caption: string,
    job: { id: string; queuedCount: number; skippedCount: number },
  ): Promise<boolean> {
    // Подпись видят клиенты без поддержки виджетов; лимит 1024
    const shortCaption =
      caption.length > 1000 ? `${caption.slice(0, 1000)}…` : caption;
    let widgetId: string;
    try {
      widgetId = await this.telegramService.sendSharedWidget({
        chatId: admins[0],
        html: MAILING_PROGRESS_WIDGET_HTML,
        publicData: JSON.stringify({
          q: job.queuedCount,
          s: 0,
          b: 0,
          e: 0,
          k: job.skippedCount,
          st: 'processing',
          r: Date.now(),
        } satisfies MailingProgressData),
        caption: shortCaption,
      });
    } catch (error) {
      this.logger.warn(
        { err: error, jobId: job.id },
        'mailing widget: sendWidget не удался -> уведомление текстом',
      );
      return false;
    }

    await this.mailingJobRepo.update(
      { id: job.id },
      { progressWidgetId: widgetId },
    );

    for (const admin of admins.slice(1)) {
      try {
        await this.telegramService.resendSharedWidget({
          chatId: admin,
          widgetId,
          caption: shortCaption,
        });
      } catch (error) {
        this.logger.error(
          { err: error, adminTelegramId: admin, jobId: job.id },
          'mailing widget: не удалось отправить виджет админу',
        );
      }
    }
    return true;
  }

  /**
   * Обновить виджет прогресса — не чаще раза в 5 с на рассылку. Зовётся из
   * обработчика после каждой отправки; никогда не бросает — рассылку не трогаем.
   */
  async touchProgress(jobId: string): Promise<void> {
    const now = Date.now();
    if (now - (this.progressTouchedAt.get(jobId) ?? 0) < PROGRESS_THROTTLE_MS) {
      return;
    }
    this.progressTouchedAt.set(jobId, now);
    try {
      const job = await this.mailingJobRepo.findOne({ where: { id: jobId } });
      if (!job?.progressWidgetId || job.status !== 'processing') return;
      await this.telegramService.editSharedWidgetData(
        job.progressWidgetId,
        this.progressData(job),
      );
    } catch (error) {
      this.logger.warn(
        { err: error, jobId },
        'mailing widget: не удалось обновить прогресс',
      );
    }
  }

  /** Финальные цифры в виджет; вернёт короткий текст для пинга админам. */
  private async finishProgressWidget(job: MailingJobEntity): Promise<string> {
    this.progressTouchedAt.delete(job.id);
    const edit = () =>
      this.telegramService.editSharedWidgetData(
        job.progressWidgetId!,
        this.progressData(job),
      );
    try {
      await edit();
    } catch {
      // Лимит «раз в секунду» мог совпасть с последним промежуточным обновлением
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await edit().catch((error: unknown) =>
        this.logger.warn(
          { err: error, jobId: job.id },
          'mailing widget: финальное обновление не удалось',
        ),
      );
    }
    // Правка виджета не присылает уведомление — короткий текст, чтобы админ узнал
    return [
      job.status === 'completed'
        ? '✅ Рассылка завершена'
        : '⚠️ Рассылка завершена с ошибками',
      `Доставлено: ${job.sentCount} · заблокировали: ${job.blockedCount} · ошибки: ${job.errorCount}`,
      'Подробности — в виджете выше.',
    ].join('\n');
  }

  async notifyAdminsAboutMailingFinishByJobId(jobId: string): Promise<void> {
    const mailingJob = await this.mailingJobRepo.findOne({
      where: { id: jobId },
    });

    if (!mailingJob) {
      this.logger.warn(
        `Mailing job not found for finish notification: ${jobId}`,
      );
      return;
    }

    // const errors = await this.mailingMessageRepo.find({
    //   where: {
    //     mailingJobId: jobId,
    //     sendStatus: 'failed',
    //   },
    //   order: {
    //     id: 'ASC',
    //   },
    //   take: 10,
    // });

    // const formattedErrors = errors.map((e) => ({
    //   userId: e.userId,
    //   telegramId: e.telegramId,
    //   error: e.sendError ?? 'Unknown error',
    // }));

    await this.notifyAdminsAboutMailingFinish(mailingJob);
  }
}
