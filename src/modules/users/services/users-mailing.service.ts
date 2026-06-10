import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ContestParticipation } from 'src/modules/contests/entities/contest-participation.entity';
import { UserRole } from 'src/shared/enums/user';
import { User } from '../entities';
import { SendUsersMailingDto } from '../dto/send-users-mailing.dto';
import { TelegramService } from 'src/modules/bot/bot.service';
import { UserMailingType } from 'src/shared/enums/user/user-mailing-type.enum';
import { ContestPublicationService } from '../../contests/services/contest-publication.service';
import { Logger } from 'nestjs-pino';
import { ContestPublication } from 'src/modules/contests/entities';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MailingJobEntity } from '../entities/mailing-jobs.entity';

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
      ? await this.contestPublicationService.getPublicationByContestId(dto.contestId)
      : undefined;

    this.logger.log(`Получено пользователей для рассылки: ${users.length}`);

    await this.notifyAdminsAboutMailingStart(dto, image, users.length);

    const imagePath = image ? `/uploads/mailings/${image.filename}` : undefined;
    const finalButtonUrl = this.resolveButtonUrl(dto, publication);
    const text = dto.text || publication?.payload?.text;
    const finalImagePath = imagePath || publication?.payload?.photoUrl;
    const buttonText = dto.buttonText || publication?.payload?.buttonText;

    const jobId = `mailing-${Date.now()}`;

    const recipientsWithTelegram = users.filter((user) => !!user.telegramId);
    const skippedCount = users.length - recipientsWithTelegram.length;

    await this.mailingJobRepo.save({
      id: jobId,
      type: dto.type,
      initiatorUserId: dto.userId ?? null,
      contestId: dto.contestId ?? null,
      groupId: dto.groupId ? String(dto.groupId) : null,
      totalRecipients: users.length,
      queuedCount: recipientsWithTelegram.length,
      skippedCount,
      sentCount: 0,
      failedCount: 0,
      deletedCount: 0,
      deleteFailedCount: 0,
      deleteAfter: this.getNextDayDeleteDate(),
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
      await this.mailingJobRepo.update({ id: jobId }, { status: 'failed', error: String(error), finishedAt: new Date() });
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
      this.logger.debug({ contestId: dto.contestId }, 'resolveButtonUrl: building URL from contestId');

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
        { publicationId: publication.id, telegramMessageId: publication.telegramMessageId, chatId: publication.chatId },
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
      this.logger.debug({ buttonUrl: dto.buttonUrl }, 'resolveButtonUrl: using provided buttonUrl');
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
      this.logger.warn({ telegramId: telegramIdStr }, 'buildTelegramPostUrl: отсутствует messageId');
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
          this.logger.warn({ type: dto.type }, 'getRecipients: userId не передан');
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
          { groupId: dto.groupId, participations: participations.length, uniqueUsers: uniqueUserIds.length },
          'getRecipients: GROUP participations',
        );

        if (!uniqueUserIds.length) {
          this.logger.warn({ groupId: dto.groupId }, 'getRecipients: получатели не найдены');
          return [];
        }

        const users = await this.usersRepository.find({
          where: {
            id: In(uniqueUserIds),
            role: UserRole.USER,
          },
        });

        this.logger.debug({ count: users.length }, 'getRecipients: GROUP users loaded');

        return users;
      }

      case UserMailingType.ALL: {
        const users = await this.usersRepository.find({
          where: {
            role: UserRole.USER,
          },
        });

        this.logger.debug({ count: users.length }, 'getRecipients: ALL users loaded');

        return users;
      }

      default:
        this.logger.warn({ type: dto.type }, 'getRecipients: неизвестный тип рассылки');
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

  private getAdminTelegramIdsFromEnv(): string[] {
    const raw = process.env.ADMIN_IDS;

    if (!raw) {
      this.logger.warn('ADMIN_IDS не задан в env');
      return [];
    }

    return raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }
  private async notifyAdminsAboutMailingStart(
    dto: SendUsersMailingDto,
    image: Express.Multer.File | undefined,
    recipientsCount?: number,
  ): Promise<void> {
    try {
      // const admins = await this.getAdminRecipients();
      const admins = this.getAdminTelegramIdsFromEnv();

      if (!admins.length) {
        this.logger.warn(
          'Нет админов с telegramId для уведомления о старте рассылки',
        );
        return;
      }

      const text = this.buildMailingStartMessage(dto, image, recipientsCount);

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
      const admins = this.getAdminTelegramIdsFromEnv();

      if (!admins.length) {
        this.logger.warn(
          'Нет админов с telegramId для уведомления о завершении рассылки',
        );
        return;
      }

      const text = this.buildMailingFinishMessage(mailingJob);

      for (const admin of admins) {
        try {
          await this.telegramService.sendMailingMessage({
            chatId: admin!,
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

  private getNextDayDeleteDate(): Date {
    const deleteAt = new Date();

    deleteAt.setDate(deleteAt.getDate() + 1);
    deleteAt.setHours(13, 59, 0, 0);

    return deleteAt;
  }
}
