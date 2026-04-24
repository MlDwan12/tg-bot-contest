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
import { ContestsService } from '../../contests/services/contests.service';
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
    private readonly contestsService: ContestsService,
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
      ? await this.contestsService.getPublicationByContestId(dto.contestId)
      : undefined;

    this.logger.log(`Получено пользователей для рассылки: ${users.length}`);

    await this.notifyAdminsAboutMailingStart(dto, image);

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

    this.logger.log(
      `Рассылка поставлена в очередь: jobId=${jobId}, count=${users.length}`,
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
      this.logger.log(`Определение ссылки по contestId=${dto.contestId}`);

      // const publication = await this.contestsService.getPublicationByContestId(
      //   dto.contestId,
      // );

      if (!publication) {
        this.logger.warn(
          `Публикация конкурса не найдена для contestId=${dto.contestId}`,
        );
        throw new NotFoundException('Contest publication not found');
      }

      this.logger.log(
        `Публикация найдена: publicationId=${publication.id}, telegramMessageId=${publication.telegramMessageId}, channelId=${publication.channel?.id ?? '-'}, chatId=${publication.chatId}`,
      );

      const postUrl = this.buildTelegramPostUrl({
        telegramUsername: publication.channel?.telegramUsername,
        telegramId:
          publication.channel?.telegramId ?? String(publication.chatId),
        messageId: publication.telegramMessageId!,
      });

      this.logger.log(`Собрана ссылка на telegram-пост: ${postUrl}`);

      return postUrl;
    }

    if (dto.buttonUrl) {
      this.logger.log(`Используется переданный buttonUrl: ${dto.buttonUrl}`);
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

    this.logger.log(
      `Построение ссылки на пост: telegramUsername=${telegramUsername ?? '-'}, telegramId=${telegramIdStr ?? '-'}, messageId=${messageId ?? '-'}`,
    );

    if (!messageId) {
      this.logger.warn('Невозможно построить ссылку: отсутствует messageId');
      throw new BadRequestException('Publication messageId is missing');
    }

    if (telegramUsername) {
      const url = `https://t.me/${telegramUsername}/${messageId}`;
      this.logger.log(`Собрана публичная ссылка на пост: ${url}`);
      return url;
    }

    if (telegramIdStr?.startsWith('-100')) {
      const internalChatId = telegramIdStr.slice(4);
      const url = `https://t.me/c/${internalChatId}/${messageId}`;
      this.logger.log(`Собрана ссылка на приватный пост: ${url}`);
      return url;
    }

    this.logger.warn(
      `Невозможно построить Telegram post URL: telegramUsername=${telegramUsername ?? '-'}, telegramId=${telegramIdStr ?? '-'}`,
    );

    throw new BadRequestException(
      'Cannot build Telegram post URL: channel username or valid telegramId is required',
    );
  }

  private async getRecipients(dto: SendUsersMailingDto): Promise<User[]> {
    this.logger.log(`Получение получателей для type=${dto.type}`);

    switch (dto.type) {
      case UserMailingType.USER: {
        if (!dto.userId) {
          this.logger.warn('Для USER рассылки не передан userId');
          throw new BadRequestException(
            'userId is required for USER mailing type',
          );
        }

        this.logger.log(
          `Поиск одного пользователя по telegramId=${dto.userId}`,
        );

        const user = await this.usersRepository.findOne({
          where: {
            telegramId: String(dto.userId),
            role: UserRole.USER,
          },
        });

        if (!user) {
          this.logger.warn(
            `Пользователь не найден по telegramId=${dto.userId}`,
          );
          throw new NotFoundException('User not found');
        }

        this.logger.log(`Найден пользователь userId=${user.id}`);

        return [user];
      }

      case UserMailingType.GROUP: {
        this.logger.log(`Поиск участников группы groupId=${dto.groupId}`);

        const participations = await this.participationRepository.find({
          where: {
            groupId: dto.groupId,
          },
          select: {
            userId: true,
          },
        });

        this.logger.log(`Найдено участий по группе: ${participations.length}`);

        const uniqueUserIds = [...new Set(participations.map((p) => p.userId))];

        this.logger.log(`Уникальных userId в группе: ${uniqueUserIds.length}`);

        if (!uniqueUserIds.length) {
          this.logger.warn(`Для groupId=${dto.groupId} получатели не найдены`);
          return [];
        }

        const users = await this.usersRepository.find({
          where: {
            id: In(uniqueUserIds),
            role: UserRole.USER,
          },
        });

        this.logger.log(
          `Пользователей для GROUP рассылки найдено: ${users.length}`,
        );

        return users;
      }

      case UserMailingType.ALL: {
        this.logger.log('Получение всех пользователей для ALL рассылки');

        const users = await this.usersRepository.find({
          where: {
            role: UserRole.USER,
          },
        });

        this.logger.log(
          `Пользователей для ALL рассылки найдено: ${users.length}`,
        );

        return users;
      }

      default:
        this.logger.warn(`Неизвестный тип рассылки: ${dto.type}`);
        return [];
    }
  }

  private async getAdminRecipients(): Promise<User[]> {
    const admins = await this.usersRepository.find({
      where: {
        role: UserRole.ADMIN,
      },
    });

    this.logger.log(`Найдено админов для уведомления: ${admins.length}`);

    return admins.filter((admin) => !!admin.telegramId);
  }

  private getAdminTelegramIdsFromEnv(): string[] {
    const raw = process.env.ADMIN_IDS;
    console.log(1111, raw);

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
            `Не удалось отправить уведомление о старте админу userId=${admin}, telegramId=${admin}: ${error?.message ?? 'Unknown error'}`,
            error?.stack,
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        `Ошибка при уведомлении админов о старте рассылки: ${error?.message ?? 'Unknown error'}`,
        error?.stack,
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
          console.log(admin);

          await this.telegramService.sendMailingMessage({
            chatId: admin!,
            text,
          });
        } catch (error: any) {
          this.logger.error(
            `Не удалось отправить уведомление о завершении админу userId=${admin}, telegramId=${admin}: ${error?.message ?? 'Unknown error'}`,
            error?.stack,
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        `Ошибка при уведомлении админов о завершении рассылки: ${error?.message ?? 'Unknown error'}`,
        error?.stack,
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
