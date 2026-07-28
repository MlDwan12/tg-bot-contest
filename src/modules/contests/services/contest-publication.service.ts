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
  CONTEST_PARTICIPATE_REPOSITORY,
  CONTEST_REPOSITORY,
} from 'src/common/constants';
import type {
  IContestParticipationRepository,
  IContestRepository,
} from '../interfaces';
import { ContestPublication } from '../entities';
import { ContestStatus, PublicationStatus } from 'src/common/enums/contest';
import { Channel } from 'src/modules/channels/entities';
import { TelegramService } from 'src/modules/bot/bot.service';
import { ContestWinnerService } from './contest-winner.service';
import {
  buildContestResultsText,
  ResultsWinner,
  TELEGRAM_CAPTION_LIMIT,
  TELEGRAM_TEXT_LIMIT,
} from './contest-results-text.util';

/**
 * Минимальный контекст для синхронизации опубликованных постов — только поля,
 * что реально читает syncPublishedPosts. Структурно подходят и entity Contest,
 * и обогащённый ContestWithRelations (из findByIdWithRelations).
 */
export interface ContestForPublishSync {
  id: number;
  name: string;
  description: string | null | undefined;
  imagePath: string | null | undefined;
  buttonText: string | null | undefined;
  status: ContestStatus;
  participants: ReadonlyArray<unknown>;
}

@Injectable()
export class ContestPublicationService {
  constructor(
    @Inject(CONTEST_REPOSITORY)
    private readonly contestRepo: IContestRepository,

    @Inject(CONTEST_PARTICIPATE_REPOSITORY)
    private readonly contestParticipationRepo: IContestParticipationRepository,

    @InjectQueue('contest-publication')
    private readonly publicationQueue: Queue,

    private readonly configService: ConfigService,

    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,

    private readonly contestWinnerService: ContestWinnerService,

    private readonly logger: Logger,
  ) {}

  async getPendingPublicationIds(contestId: number): Promise<number[]> {
    return this.contestRepo.getPublicationIdsByStatus(
      contestId,
      PublicationStatus.PENDING,
    );
  }

  async claimPublication(
    publicationId: number,
  ): Promise<ContestPublication | null> {
    return this.contestRepo.claimPublication(publicationId);
  }

  async markPublicationPublished(
    publicationId: number,
    messageId: number,
  ): Promise<void> {
    await this.contestRepo.markPublicationPublished(publicationId, {
      telegramMessageId: messageId,
      publishedAt: new Date(),
    });
  }

  async failPublication(publicationId: number, error: string): Promise<void> {
    await this.contestRepo.markPublicationFailed(publicationId, {
      error: error.slice(0, 4000),
    });
  }

  async bumpPublicationError(
    publicationId: number,
    error: string,
  ): Promise<void> {
    await this.contestRepo.bumpPublicationError(publicationId, {
      error: error.slice(0, 4000),
    });
  }

  async getPublicationByContestId(
    contestId: number,
  ): Promise<ContestPublication> {
    const publication =
      await this.contestRepo.findPublicationByContestId(contestId);

    if (!publication) {
      throw new NotFoundException('Публикация конкурса не найдена');
    }

    return publication;
  }

  async getPublicationsByContestId(
    contestId: number,
  ): Promise<ContestPublication[]> {
    return this.contestRepo.findPublicationsByContestId(contestId);
  }

  async getPublishedPublicationIdsForContest(
    contestId: number,
  ): Promise<number[]> {
    return (
      await this.contestRepo.findPublishedPublicationIdsForContest(contestId)
    ).map((pub) => pub.id);
  }

  getPublicationForFinishUpdate(
    publicationId: number,
  ): Promise<Pick<
    ContestPublication,
    'id' | 'contestId' | 'chatId' | 'telegramMessageId' | 'payload'
  > | null> {
    return this.contestRepo.findPublicationForFinishUpdate(publicationId);
  }

  /**
   * Готовит правку поста завершённого конкурса: текст с блоком победителей и
   * кнопка «Конкурс завершён». Сам вызов Telegram делает процессор — здесь
   * только чтение из БД и сборка.
   *
   * hasPhoto определяет лимит длины: у поста с картинкой это подпись (1024),
   * у текстового — 4096.
   */
  async buildFinishedPostUpdate(params: {
    contestId: number;
    chatId: number;
    hasPhoto: boolean;
  }): Promise<{
    text: string;
    buttonText: string;
    buttonUrl: string;
    shownWinners: number;
    truncated: boolean;
  } | null> {
    const contest = await this.contestRepo.findByParams({
      id: params.contestId,
    });

    if (!contest) return null;

    const winners = await this.contestWinnerService.getContestWinners(
      params.contestId,
    );

    const results = buildContestResultsText({
      name: contest.name,
      description: contest.description,
      winners: this.toResultsWinners(winners),
      limit: params.hasPhoto ? TELEGRAM_CAPTION_LIMIT : TELEGRAM_TEXT_LIMIT,
    });

    const miniAppUrl = this.configService.get<string>('MINI_APP_URL');

    return {
      text: results.text,
      buttonText: 'Конкурс завершён',
      buttonUrl: `${miniAppUrl}?startapp=${params.chatId}_${params.contestId}`,
      shownWinners: results.shownWinners,
      truncated: results.truncated,
    };
  }

  /**
   * Строки победителей из БД → вход форматтера. Фиктивный победитель (ник,
   * вписанный оператором без TG-аккаунта) не имеет user: его имя лежит в
   * displayUsername, и форматтер берёт именно его.
   */
  private toResultsWinners(
    winners: Array<{
      place: number;
      userId: number | null;
      displayUsername: string | null;
      user?: { username?: string; firstName?: string } | null;
    }>,
  ): ResultsWinner[] {
    return winners.map((winner) => ({
      place: winner.place,
      username: winner.user?.username,
      firstName: winner.user?.firstName,
      displayUsername: winner.displayUsername,
      userId: winner.userId,
    }));
  }

  async recreatePendingPublications(params: {
    contestId: number;
    channels: Channel[];
    name: string;
    description?: string;
    buttonText?: string;
    imagePath?: string;
  }): Promise<void> {
    await this.contestRepo.deletePendingPublicationsByContestId(
      params.contestId,
    );

    if (!params.channels.length) {
      return;
    }

    const publicationTasks = this.buildPublicationTasks(params);
    await this.contestRepo.createPublications(publicationTasks);
  }

  async cancelContestPublications(contestId: number): Promise<void> {
    // Публикации берём здесь (в домене contests) и ПЕРЕДАЁМ боту. Раньше bot
    // дёргал этот же сервис обратно (round-trip) — это и держало цикл bot↔contests.
    const publications = await this.getPublicationsByContestId(contestId);
    await this.telegramService.deletePublicationMessages(publications);
    await this.contestRepo.cancelPendingPublications(contestId);
  }

  async syncPublishedPosts(contest: ContestForPublishSync): Promise<void> {
    const publishedPublications =
      await this.contestRepo.findPublishedPublicationIdsForContest(contest.id);

    if (!publishedPublications.length) {
      this.logger.debug(
        { contestId: contest.id },
        'У конкурса нет опубликованных постов для синхронизации',
      );
      return;
    }

    const miniAppUrl = this.configService.get<string>('MINI_APP_URL');

    // У завершённого конкурса в посте должен стоять блок победителей. Это тот
    // же текст, что публикует джоб updateFinishedButton при автозавершении:
    // сюда приходит ручное завершение (completeContest) и правка уже
    // завершённого конкурса — без этого итоги бы не появились либо затёрлись
    // базовым текстом.
    const winners =
      contest.status === ContestStatus.COMPLETED
        ? this.toResultsWinners(
            await this.contestWinnerService.getContestWinners(contest.id),
          )
        : [];

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

      // Без победителей buildContestResultsText отдаёт ровно прежний
      // `name\n\ndescription` — для незавершённых конкурсов текст не меняется.
      const results = buildContestResultsText({
        name: contest.name,
        description: contest.description,
        winners,
        limit: photoUrl ? TELEGRAM_CAPTION_LIMIT : TELEGRAM_TEXT_LIMIT,
      });

      if (results.truncated) {
        this.logger.warn(
          {
            contestId: contest.id,
            publicationId: publication.id,
            shownWinners: results.shownWinners,
          },
          'syncPublishedPosts: блок победителей не поместился в лимит целиком',
        );
      }

      try {
        await this.telegramService.updateContestPublishedMessage({
          chatId: String(publication.chatId),
          messageId: publication.telegramMessageId,
          text: results.text,
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
    const contest = await this.contestRepo.findByIdWithRelations(contestId);

    if (!contest) {
      this.logger.warn(
        { contestId },
        'Конкурс не найден при синхронизации счётчика участников',
      );
      return;
    }

    const participantsCount =
      await this.contestParticipationRepo.countUniqueUsersByContestId(
        contestId,
      );

    const nextButtonText = this.buildParticipantsButtonText(
      contest.buttonText ?? undefined,
      participantsCount,
    );

    const publications =
      await this.contestRepo.findPublishedPublicationsByContestId(contestId);

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

        await this.contestRepo.updatePublication(publication.id, {
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
