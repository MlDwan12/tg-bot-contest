import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import {
  ContestParticipationReadRepository,
  ContestReadRepository,
  ContestWriteRepository,
} from '../repositories';
import {
  CONTEST_PARTICIPATE_READ_REPOSITORY,
  CONTEST_READ_REPOSITORY,
  CONTEST_WRITE_REPOSITORY,
} from 'src/common/constants';
import { Contest, ContestPublication } from '../entities';
import { ContestStatus, PublicationStatus } from 'src/common/enums/contest';
import { Channel } from 'src/modules/channels/entities';
import { TelegramService } from 'src/modules/bot/bot.service';

@Injectable()
export class ContestPublicationService {
  constructor(
    @Inject(CONTEST_READ_REPOSITORY)
    private readonly contestReadRepo: ContestReadRepository,

    @Inject(CONTEST_WRITE_REPOSITORY)
    private readonly contestWriteRepo: ContestWriteRepository,

    @Inject(CONTEST_PARTICIPATE_READ_REPOSITORY)
    private readonly contestParticipationReadRepo: ContestParticipationReadRepository,

    @InjectQueue('contest-publication')
    private readonly publicationQueue: Queue,

    private readonly configService: ConfigService,

    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,

    private readonly logger: Logger,
  ) {}

  async getPendingPublicationIds(contestId: number): Promise<number[]> {
    return this.contestReadRepo.getPublicationIdsByStatus(
      contestId,
      PublicationStatus.PENDING,
    );
  }

  async claimPublication(
    publicationId: number,
  ): Promise<ContestPublication | null> {
    return this.contestWriteRepo.claimPublication(publicationId);
  }

  async markPublicationPublished(
    publicationId: number,
    messageId: number,
  ): Promise<void> {
    await this.contestWriteRepo.markPublicationPublished(publicationId, {
      telegramMessageId: messageId,
      publishedAt: new Date(),
    });
  }

  async failPublication(publicationId: number, error: string): Promise<void> {
    await this.contestWriteRepo.markPublicationFailed(publicationId, {
      error: error.slice(0, 4000),
    });
  }

  async bumpPublicationError(
    publicationId: number,
    error: string,
  ): Promise<void> {
    await this.contestWriteRepo.bumpPublicationError(publicationId, {
      error: error.slice(0, 4000),
    });
  }

  async getPublicationByContestId(
    contestId: number,
  ): Promise<ContestPublication> {
    const publication =
      await this.contestReadRepo.findPublicationByContestId(contestId);

    if (!publication) {
      throw new NotFoundException('Публикация конкурса не найдена');
    }

    return publication;
  }

  async getPublicationsByContestId(
    contestId: number,
  ): Promise<ContestPublication[]> {
    return this.contestReadRepo.findPublicationsByContestId(contestId);
  }

  async getPublishedPublicationIdsForContest(
    contestId: number,
  ): Promise<number[]> {
    return (
      await this.contestReadRepo.findPublishedPublicationIdsForContest(
        contestId,
      )
    ).map((pub) => pub.id);
  }

  getPublicationForButtonUpdate(
    publicationId: number,
  ): Promise<Pick<
    ContestPublication,
    'id' | 'contestId' | 'chatId' | 'telegramMessageId'
  > | null> {
    return this.contestReadRepo.findPublicationForButtonUpdate(publicationId);
  }

  async recreatePendingPublications(params: {
    contestId: number;
    channels: Channel[];
    name: string;
    description?: string;
    buttonText?: string;
    imagePath?: string;
  }): Promise<void> {
    await this.contestWriteRepo.deletePendingPublicationsByContestId(
      params.contestId,
    );

    if (!params.channels.length) {
      return;
    }

    const publicationTasks = this.buildPublicationTasks(params);
    await this.contestWriteRepo.createPublications(publicationTasks);
  }

  async cancelContestPublications(contestId: number): Promise<void> {
    await this.telegramService.deleteContestPublications(contestId);
    await this.contestWriteRepo.cancelPendingPublications(contestId);
  }

  async syncPublishedPosts(contest: Contest): Promise<void> {
    const publishedPublications =
      await this.contestReadRepo.findPublishedPublicationIdsForContest(
        contest.id,
      );

    if (!publishedPublications.length) {
      this.logger.debug(
        { contestId: contest.id },
        'У конкурса нет опубликованных постов для синхронизации',
      );
      return;
    }

    const miniAppUrl = this.configService.get<string>('MINI_APP_URL');

    for (const publication of publishedPublications) {
      if (!publication.telegramMessageId) {
        this.logger.warn(
          { contestId: contest.id, publicationId: publication.id },
          'Пропущена синхронизация: отсутствует telegramMessageId',
        );
        continue;
      }

      if (!publication.chatId) {
        this.logger.warn(
          { contestId: contest.id, publicationId: publication.id },
          'Пропущена синхронизация: отсутствует chatId',
        );
        continue;
      }

      const photoUrl =
        contest.imagePath && !contest.imagePath.endsWith('/undefined')
          ? contest.imagePath
          : undefined;

      try {
        await this.telegramService.updateContestPublishedMessage({
          chatId: String(publication.chatId),
          messageId: publication.telegramMessageId,
          text: `${contest.name}\n\n${contest.description || ''}`,
          buttonText:
            contest.status === ContestStatus.COMPLETED
              ? 'Конкурс завершён'
              : contest.participants.length > 0
                ? `${contest.buttonText ?? 'Участвовать'} (${contest.participants.length})`
                : (contest.buttonText ?? 'Участвовать'),
          buttonUrl: `${miniAppUrl}?startapp=${publication.chatId}_${contest.id}`,
          photoUrl,
        });
      } catch (error) {
        this.logger.error(
          {
            err: error,
            contestId: contest.id,
            publicationId: publication.id,
            chatId: publication.chatId,
            telegramMessageId: publication.telegramMessageId,
          },
          'Ошибка при обновлении опубликованного поста конкурса',
        );
      }
    }
  }

  async syncParticipantsCounter(contestId: number): Promise<void> {
    const contest = await this.contestReadRepo.findByIdWithRelations(contestId);

    if (!contest) {
      this.logger.warn(
        { contestId },
        'Конкурс не найден при синхронизации счётчика участников',
      );
      return;
    }

    const participantsCount =
      await this.contestParticipationReadRepo.countUniqueUsersByContestId(
        contestId,
      );

    const nextButtonText = this.buildParticipantsButtonText(
      contest.buttonText,
      participantsCount,
    );

    const publications =
      await this.contestWriteRepo.findPublishedPublicationsByContestId(
        contestId,
      );

    if (!publications.length) {
      this.logger.debug(
        { contestId, participantsCount },
        'Нет опубликованных публикаций для обновления счётчика участников',
      );
      return;
    }

    for (const publication of publications) {
      try {
        const payload = (publication.payload ?? {}) as {
          text?: string;
          buttonText?: string;
          buttonUrl?: string;
          photoUrl?: string;
        };

        const chatId = publication.chatId ?? publication.channel?.telegramId;
        const messageId = publication.telegramMessageId;

        if (!chatId || !messageId || !payload.buttonUrl) {
          continue;
        }

        if (payload.buttonText === nextButtonText) {
          continue;
        }

        await this.telegramService.updateContestMessageButton({
          chatId: String(chatId),
          messageId,
          buttonText: nextButtonText,
          buttonUrl: payload.buttonUrl,
        });

        await this.contestWriteRepo.updatePublication(publication.id, {
          payload: {
            text:
              payload.text ?? `${contest.name}\n\n${contest.description || ''}`,
            buttonUrl: payload.buttonUrl,
            photoUrl: payload.photoUrl,
            buttonText: nextButtonText,
          },
        });
      } catch (error) {
        this.logger.error(
          { err: error, contestId, publicationId: publication.id },
          'Ошибка при обновлении кнопки счётчика участников',
        );
      }
    }
  }

  async validateBotPermissionsForPublishChannels(
    channels: Channel[],
  ): Promise<void> {
    const errors: string[] = [];

    for (const channel of channels) {
      if (!channel.telegramId) {
        errors.push(
          `У канала "${channel.name ?? channel.id}" отсутствует telegramId`,
        );
        continue;
      }

      const check = await this.telegramService.checkBotChannelPermissions(
        Number(channel.telegramId),
      );

      const channelLabel =
        channel.name ?? channel.telegramUsername ?? channel.telegramId;

      if (!check.exists) {
        errors.push(`Бот не найден в канале "${channelLabel}"`);
        continue;
      }

      if (!check.isAdmin) {
        errors.push(`Бот не администратор канала "${channelLabel}"`);
      }

      if (!check.canPost) {
        errors.push(`Нет права на публикацию в "${channelLabel}"`);
      }

      if (!check.canEdit) {
        errors.push(`Нет права на редактирование в "${channelLabel}"`);
      }
    }

    if (errors.length) {
      throw new BadRequestException(errors.join('; '));
    }
  }

  private buildPublicationTasks(params: {
    contestId: number;
    channels: Channel[];
    name: string;
    description?: string;
    buttonText?: string;
    imagePath?: string;
  }): Array<Partial<ContestPublication>> {
    const { contestId, channels, name, description, buttonText, imagePath } =
      params;
    const miniAppUrl = this.configService.get<string>('MINI_APP_URL');

    return channels.map((channel) => {
      if (!channel.telegramId) {
        throw new BadRequestException(
          `У канала ${channel.id} отсутствует telegramId`,
        );
      }

      const chatId = Number(channel.telegramId);

      if (Number.isNaN(chatId)) {
        throw new BadRequestException(
          `У канала ${channel.id} некорректный telegramId`,
        );
      }

      return {
        contestId,
        channelId: channel.id,
        chatId,
        status: PublicationStatus.PENDING,
        payload: {
          text: `${name}\n\n${description || ''}`,
          buttonText: buttonText || 'Участвовать',
          buttonUrl: `${miniAppUrl}?startapp=${channel.telegramId}_${contestId}`,
          photoUrl: imagePath,
        },
      };
    });
  }

  private buildParticipantsButtonText(
    baseButtonText?: string,
    participantsCount?: number,
  ): string {
    const text = baseButtonText?.trim() || 'Участвовать';

    if (!participantsCount || participantsCount <= 0) {
      return text;
    }

    return `${text} (${participantsCount})`;
  }
}
