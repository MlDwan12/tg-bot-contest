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

@Injectable()
export class UsersMailingService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(ContestParticipation)
    private readonly participationRepository: Repository<ContestParticipation>,
    private readonly telegramService: TelegramService,
    private readonly contestsService: ContestsService,
    private readonly logger: Logger,
  ) {}

  async sendMailing(
    dto: SendUsersMailingDto,
    image?: Express.Multer.File,
  ): Promise<{
    total: number;
    success: number;
    failed: number;
    errors: Array<{ userId: number; telegramId: string; error: string }>;
  }> {
    this.logger.log(
      `Запуск рассылки: type=${dto.type}, userId=${dto.userId ?? '-'}, groupId=${dto.groupId ?? '-'}, contestId=${dto.contestId ?? '-'}, hasButton=${!!dto.buttonText}, hasImage=${!!image}`,
    );

    this.validateButton(dto);

    await this.notifyAdminsAboutMailingStart(dto, image);

    const users = await this.getRecipients(dto);
    const publication = dto.contestId
      ? await this.contestsService.getPublicationByContestId(dto.contestId)
      : undefined;

    this.logger.log(`Получено пользователей для рассылки: ${users.length}`);

    const imagePath = image ? `/uploads/mailings/${image.filename}` : undefined;

    if (imagePath) {
      this.logger.log(`Будет отправлено сообщение с медиа: ${imagePath}`);
    }

    let success = 0;
    let failed = 0;
    const errors: Array<{ userId: number; telegramId: string; error: string }> =
      [];

    try {
      const finalButtonUrl = this.resolveButtonUrl(dto, publication);

      this.logger.log(
        `Финальная ссылка кнопки: ${finalButtonUrl ?? 'кнопка отсутствует'}`,
      );

      for (const user of users) {
        if (!user.telegramId) {
          failed++;
          errors.push({
            userId: user.id,
            telegramId: '',
            error: 'User has no telegramId',
          });

          this.logger.warn(
            `Пропуск пользователя userId=${user.id}: отсутствует telegramId`,
          );
          continue;
        }

        try {
          this.logger.log(
            `Отправка сообщения пользователю userId=${user.id}, telegramId=${user.telegramId}`,
          );

          const result = await this.telegramService.sendMailingMessage({
            chatId: user.telegramId,
            text: dto.text || publication?.payload?.text,
            imagePath: imagePath || publication?.payload?.photoUrl,
            buttonText: dto.buttonText || publication?.payload?.buttonText,
            buttonUrl: finalButtonUrl,
          });

          success++;

          this.logger.log(
            `Сообщение отправлено userId=${user.id}, telegramId=${user.telegramId}, messageId=${result.messageId}`,
          );
        } catch (error: any) {
          failed++;
          const errorMessage = error?.message ?? 'Unknown error';

          errors.push({
            userId: user.id,
            telegramId: user.telegramId,
            error: errorMessage,
          });

          this.logger.error(
            `Ошибка отправки userId=${user.id}, telegramId=${user.telegramId}: ${errorMessage}`,
            error?.stack,
          );
        }
      }

      const result = {
        total: users.length,
        success,
        failed,
        errors,
      };

      this.logger.log(
        `Рассылка завершена: total=${result.total}, success=${result.success}, failed=${result.failed}`,
      );

      await this.notifyAdminsAboutMailingFinish(dto, result, image);

      return result;
    } catch (error: any) {
      this.logger.error(
        `Критическая ошибка при выполнении рассылки: ${error?.message ?? 'Unknown error'}`,
        error?.stack,
      );

      const result = {
        total: users.length,
        success,
        failed,
        errors: [
          ...errors,
          {
            userId: 0,
            telegramId: '',
            error: error?.message ?? 'Unknown error',
          },
        ],
      };

      await this.notifyAdminsAboutMailingFinish(dto, result, image, error);

      throw error;
    }
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

  private async notifyAdminsAboutMailingStart(
    dto: SendUsersMailingDto,
    image?: Express.Multer.File,
  ): Promise<void> {
    try {
      const admins = await this.getAdminRecipients();

      if (!admins.length) {
        this.logger.warn(
          'Нет админов с telegramId для уведомления о старте рассылки',
        );
        return;
      }

      const text = this.buildMailingStartMessage(dto, image);

      for (const admin of admins) {
        try {
          await this.telegramService.sendMailingMessage({
            chatId: admin.telegramId!,
            text,
          });
        } catch (error: any) {
          this.logger.error(
            `Не удалось отправить уведомление о старте админу userId=${admin.id}, telegramId=${admin.telegramId}: ${error?.message ?? 'Unknown error'}`,
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
    dto: SendUsersMailingDto,
    result: {
      total: number;
      success: number;
      failed: number;
      errors: Array<{ userId: number; telegramId: string; error: string }>;
    },
    image?: Express.Multer.File,
    fatalError?: any,
  ): Promise<void> {
    try {
      const admins = await this.getAdminRecipients();

      if (!admins.length) {
        this.logger.warn(
          'Нет админов с telegramId для уведомления о завершении рассылки',
        );
        return;
      }

      const text = this.buildMailingFinishMessage(
        dto,
        result,
        image,
        fatalError,
      );

      for (const admin of admins) {
        try {
          await this.telegramService.sendMailingMessage({
            chatId: admin.telegramId!,
            text,
          });
        } catch (error: any) {
          this.logger.error(
            `Не удалось отправить уведомление о завершении админу userId=${admin.id}, telegramId=${admin.telegramId}: ${error?.message ?? 'Unknown error'}`,
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
    image?: Express.Multer.File,
  ): string {
    return [
      '🚀 Запущена рассылка',
      '',
      `Тип: ${dto.type}`,
      `Текст: ${dto.text}`,
      `User ID: ${dto.userId ?? '-'}`,
      `Group ID: ${dto.groupId ?? '-'}`,
      `Contest ID: ${dto.contestId ?? '-'}`,
      `Текст кнопки: ${dto.buttonText ?? '-'}`,
      `Ссылка кнопки: ${dto.buttonUrl ?? '-'}`,
      `Медиа: ${image?.filename ?? 'нет'}`,
    ].join('\n');
  }

  private buildMailingFinishMessage(
    dto: SendUsersMailingDto,
    result: {
      total: number;
      success: number;
      failed: number;
      errors: Array<{ userId: number; telegramId: string; error: string }>;
    },
    image?: Express.Multer.File,
    fatalError?: any,
  ): string {
    const errorLines = result.errors.length
      ? result.errors
          .slice(0, 10)
          .map(
            (e, index) =>
              `${index + 1}. userId=${e.userId}, telegramId=${e.telegramId || '-'}, error=${e.error}`,
          )
      : ['нет'];

    return [
      fatalError
        ? '❌ Рассылка завершена с критической ошибкой'
        : '✅ Рассылка завершена',
      '',
      `Тип: ${dto.type}`,
      `Текст: ${dto.text}`,
      `User ID: ${dto.userId ?? '-'}`,
      `Group ID: ${dto.groupId ?? '-'}`,
      `Contest ID: ${dto.contestId ?? '-'}`,
      `Текст кнопки: ${dto.buttonText ?? '-'}`,
      `Ссылка кнопки: ${dto.buttonUrl ?? '-'}`,
      `Медиа: ${image?.filename ?? 'нет'}`,
      '',
      `Всего: ${result.total}`,
      `Успешно: ${result.success}`,
      `Ошибок: ${result.failed}`,
      '',
      'Первые ошибки:',
      ...errorLines,
      ...(fatalError
        ? ['', `Critical error: ${fatalError?.message ?? 'Unknown error'}`]
        : []),
    ].join('\n');
  }
}
