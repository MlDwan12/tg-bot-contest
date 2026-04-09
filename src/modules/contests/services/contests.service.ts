import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContestParticipationReadRepository,
  ContestReadRepository,
  ContestWriteRepository,
} from '../repositories';
import {
  CONTEST_PARTICIPATE_READ_REPOSITORY,
  CONTEST_READ_REPOSITORY,
  CONTEST_WRITE_REPOSITORY,
} from 'src/shared/commons/constants';
import { CreateContest } from 'src/shared/types/contests';
import { Contest, ContestPublication } from '../entities';
import {
  ContestStatus,
  PublicationStatus,
  WinnerStrategy,
} from 'src/shared/enums/contest';
import { AdminService } from 'src/modules/users/services';
import { Logger } from 'nestjs-pino';
import { ChannelsService } from 'src/modules/channels/services';
import { ContestJobsService } from '../jobs/services';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { GetContestsQueryDto } from '../dto/get-contests-query.dto';
import { Paginated } from 'src/shared/commons/response/paginated.type';
import { ContestShortInfoDto } from '../dto/contest-short-info.dto';
import { UpdateContestDto } from '../dto';
import { TelegramService } from 'src/modules/bot/bot.service';
import { In } from 'typeorm';
import { UsersService } from '../../users/services/users.service';
import { User } from 'src/modules/users/entities';
import { ContestWinnerService } from './contest-winner.service';
import { ContestsParticipateService } from './contest-participate.service';
import { Channel } from 'src/modules/channels/entities';

@Injectable()
export class ContestsService {
  constructor(
    @Inject(CONTEST_READ_REPOSITORY)
    private readonly contestReadRepo: ContestReadRepository,

    @Inject(CONTEST_WRITE_REPOSITORY)
    private readonly contestWriteRepo: ContestWriteRepository,

    @Inject(CONTEST_PARTICIPATE_READ_REPOSITORY)
    private readonly contestParticipationReadRepo: ContestParticipationReadRepository,

    @InjectQueue('contest-publication')
    private readonly publicationQueue: Queue,

    private readonly adminService: AdminService,
    private readonly logger: Logger,
    private readonly channelService: ChannelsService,
    private readonly contestJobsService: ContestJobsService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    private readonly configService: ConfigService,
    private readonly contestWinnerService: ContestWinnerService,
    private readonly contestsParticipateService: ContestsParticipateService,
    private readonly usersService: UsersService,
  ) {}

  // async createContest(
  //   dto: CreateContest,
  //   image?: Express.Multer.File,
  // ): Promise<Contest> {
  //   this.logger.log(`В сервисе создания конкурса`);

  //   if (dto.startDate >= dto.endDate) {
  //     throw new BadRequestException('startDate must be before endDate');
  //   }

  //   try {
  //     const creator = await this.adminService.findById(dto.creatorId);

  //     const publishChannels = dto.publishChannelIds?.length
  //       ? await this.channelService.getChannelsByParameters({
  //           telegramId: In(dto.publishChannelIds),
  //         })
  //       : [];

  //     const requiredChannels = dto.requiredChannelIds?.length
  //       ? await this.channelService.getChannelsByParameters({
  //           telegramId: In(dto.requiredChannelIds),
  //         })
  //       : [];

  //     if (!creator) throw new NotFoundException('Creator not found');

  //     const imagePath = image
  //       ? `/uploads/contests/${image.filename}`
  //       : undefined;

  //     const contest = await this.contestWriteRepo.create({
  //       name: dto.name,
  //       description: dto.description,
  //       winnerStrategy: dto.winnerStrategy,
  //       prizePlaces: dto.prizePlaces,
  //       startDate: new Date(dto.startDate),
  //       endDate: new Date(dto.endDate),
  //       status: ContestStatus.PENDING,
  //       creatorId: dto.creatorId,
  //       imagePath,
  //       buttonText: dto.buttonText || 'Участвовать',
  //     });
  //     console.log(publishChannels);

  //     if (publishChannels.length) {
  //       const publicationTasks = publishChannels.map((channel) => ({
  //         contestId: contest.id,
  //         channelId: channel.id,
  //         chatId: channel.telegramId,
  //         status: PublicationStatus.PENDING,
  //         payload: {
  //           text: dto.postText || `${dto.name}\n\n${dto.description || ''}`,
  //           buttonText: dto.buttonText || 'Участвовать',
  //           buttonUrl: `${process.env.MINI_APP_URL}?startapp=${channel.telegramId}_${contest.id}`,
  //           photoUrl: imagePath,
  //         },
  //       }));

  //       await this.contestWriteRepo.createPublications(publicationTasks);

  //       if (dto.publishChannelIds?.length) {
  //         await this.contestWriteRepo.setPublishChannels(
  //           contest.id,
  //           dto.publishChannelIds,
  //         );
  //       }
  //     }
  //     console.log(1231231231);

  //     if (dto.requiredChannelIds?.length) {
  //       await this.contestWriteRepo.setRequiredChannels(
  //         contest.id,
  //         dto.requiredChannelIds,
  //       );
  //     }

  //     await this.contestJobsService.scheduleContest(
  //       contest.id,
  //       contest.startDate,
  //       contest.endDate,
  //     );

  //     return this.contestReadRepo.findByIdWithRelations(
  //       contest.id,
  //     ) as Promise<Contest>;
  //   } catch (error) {
  //     this.logger.error(`Ошибка при создании конкурса: ${error}`);
  //     throw error;
  //   }
  // }

  async createContest(
    dto: CreateContest,
    image?: Express.Multer.File,
  ): Promise<Contest> {
    this.logger.log(`В сервисе создания конкурса`);

    if (dto.startDate >= dto.endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }

    try {
      const creator = await this.adminService.findById(dto.creatorId);

      if (!creator) throw new NotFoundException('Creator not found');

      // const publishChannels = dto.publishChannelIds?.length
      //   ? await this.channelService.getChannelsByParameters({
      //       telegramId: In(dto.publishChannelIds),
      //     })
      //   : [];

      // const requiredChannels = dto.requiredChannelIds?.length
      //   ? await this.channelService.getChannelsByParameters({
      //       telegramId: In(dto.requiredChannelIds),
      //     })
      //   : [];

      const publishChannels = await this.getChannelsByTelegramIds(
        dto.publishChannelIds,
        'Один или несколько каналов публикации не найдены',
      );

      const requiredChannels = await this.getChannelsByTelegramIds(
        dto.requiredChannelIds,
        'Один или несколько обязательных каналов не найдены',
      );

      const imagePath = this.resolveContestImagePath(image);

      // const imagePath = image
      //   ? `/uploads/contests/${image.filename}`
      //   : undefined;

      const contest = await this.contestWriteRepo.create({
        name: dto.name,
        description: dto.description,
        winnerStrategy: dto.winnerStrategy,
        prizePlaces: dto.prizePlaces,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        status: ContestStatus.PENDING,
        creatorId: dto.creatorId,
        imagePath,
        buttonText: dto.buttonText || 'Участвовать',
      });

      await this.contestWriteRepo.setPublishChannels(
        contest.id,
        publishChannels.map((channel) => channel.id),
      );

      await this.contestWriteRepo.setRequiredChannels(
        contest.id,
        requiredChannels.map((channel) => channel.id),
      );

      // if (publishChannels.length) {
      //   await this.recreatePendingPublications({
      //     contestId: contest.id,
      //     channels: publishChannels,
      //     name: dto.name,
      //     description: dto.description,
      //     postText: dto.postText,
      //     buttonText: dto.buttonText,
      //     imagePath,
      //   });

      //   await this.contestWriteRepo.setPublishChannels(
      //     contest.id,
      //     publishChannels.map((channel) => channel.id),
      //   );
      //   // await this.contestWriteRepo.createPublications(publicationTasks);

      //   // if (dto.publishChannelIds?.length) {
      //   //   await this.contestWriteRepo.setPublishChannels(
      //   //     contest.id,
      //   //     publishChannels.map((channel) => channel.id),
      //   //   );
      //   // }
      // }

      // if (requiredChannels.length) {
      //   await this.contestWriteRepo.setRequiredChannels(
      //     contest.id,
      //     requiredChannels.map((channel) => channel.id),
      //   );
      // }

      await this.recreatePendingPublications({
        contestId: contest.id,
        channels: publishChannels,
        name: dto.name,
        description: dto.description,
        buttonText: dto.buttonText,
        imagePath,
      });

      await this.contestJobsService.scheduleContest(
        contest.id,
        contest.startDate,
        contest.endDate,
      );

      return this.contestReadRepo.findByIdWithRelations(
        contest.id,
      ) as Promise<Contest>;
    } catch (error) {
      this.logger.error(`Ошибка при создании конкурса: ${error}`);
      throw error;
    }
  }

  async getByStatus(status: ContestStatus): Promise<Paginated<Contest>> {
    return this.contestReadRepo.findMany({ status });
  }

  async getActiveContestById(contestId: number): Promise<Contest> {
    const contest = await this.contestReadRepo.findByParams({
      id: contestId,
      status: ContestStatus.ACTIVE,
    });

    if (!contest) {
      throw new NotFoundException('Конкурс не найден или завершен');
    }

    return contest;
  }

  /**
   * Идемпотентно переводит конкурс в ACTIVE, если уже наступило startDate.
   * Под нагрузкой важно: не делаем лишних обновлений.
   */
  async activateContestIfDue(contestId: number): Promise<void> {
    const contest = await this.contestReadRepo.findByParams({ id: contestId });
    if (!contest) return;

    // Уже активен/завершен — ничего делать не надо
    if (contest.status !== ContestStatus.PENDING) return;

    // Рано
    const now = new Date();
    if (contest.startDate > now) return;

    // Идемпотентное обновление на уровне БД (желательно через WHERE status = PENDING)
    await this.contestWriteRepo.updateStatusIfCurrent(
      contestId,
      ContestStatus.PENDING,
      ContestStatus.ACTIVE,
    );
  }

  /**
   * Возвращает id публикаций, которые нужно отправить.
   */
  async getPendingPublicationIds(contestId: number): Promise<number[]> {
    return this.contestReadRepo.getPublicationIdsByStatus(
      contestId,
      PublicationStatus.PENDING,
    );
  }

  /**
   * Атомарно "забираем" публикацию в работу: PENDING -> PROCESSING.
   * Если вернуло null — уже взяли/обработали другой воркер.
   */
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

  async updateContest(
    contestId: number,
    dto: UpdateContestDto,
    image?: Express.Multer.File,
  ): Promise<Contest> {
    ///TODO: типизировать нормально, а не any
    const contest = await this.contestReadRepo.findByIdWithRelations(contestId);

    this.logger.debug({ contestId, dto }, 'Запрос на обновление конкурса');

    if (!contest) {
      throw new NotFoundException('Конкурс не найден');
    }

    const nextStartDate = dto.startDate
      ? new Date(dto.startDate)
      : contest.startDate;

    const nextEndDate = dto.endDate ? new Date(dto.endDate) : contest.endDate;

    if (nextStartDate >= nextEndDate) {
      throw new BadRequestException('startDate must be before endDate');
    }

    if (
      dto.publishChannelIds !== undefined &&
      contest.status !== ContestStatus.PENDING
    ) {
      throw new BadRequestException(
        'Нельзя менять каналы публикации после запуска конкурса',
      );
    }

    const nextPrizePlaces: number = dto.prizePlaces ?? contest.prizePlaces;

    // let imagePath = contest.imagePath;
    const imagePath = this.resolveContestImagePath(image, contest.imagePath);

    // if (image) {
    //   if (!image.filename) {
    //     throw new BadRequestException('Файл изображения загружен некорректно');
    //   }

    //   imagePath = `/uploads/contests/${image.filename}`;
    // }

    const publishChannels =
      dto.publishChannelIds !== undefined
        ? await this.getChannelsByTelegramIds(
            dto.publishChannelIds,
            'Один или несколько каналов публикации не найдены',
          )
        : null;

    const requiredChannels =
      dto.requiredChannelIds !== undefined
        ? await this.getChannelsByTelegramIds(
            dto.requiredChannelIds,
            'Один или несколько обязательных каналов не найдены',
          )
        : null;

    // let publishGroupIds: number[] = [];
    // let requiredGroupIds: number[] = [];

    // if (dto.publishChannelIds !== undefined) {
    //   if (dto.publishChannelIds.length) {
    //     const publishChannels =
    //       await this.channelService.getChannelsByParameters({
    //         telegramId: In(dto.publishChannelIds),
    //       });

    //     if (publishChannels.length !== dto.publishChannelIds.length) {
    //       throw new NotFoundException(
    //         'Один или несколько каналов публикации не найдены',
    //       );
    //     }

    //     const publishChannelsMap = new Map(
    //       publishChannels.map((channel) => [
    //         String(channel.telegramId),
    //         channel,
    //       ]),
    //     );

    //     publishGroupIds = dto.publishChannelIds.map((telegramId) => {
    //       const channel = publishChannelsMap.get(String(telegramId));

    //       if (!channel) {
    //         throw new NotFoundException(
    //           `Канал публикации с telegramId ${telegramId} не найден`,
    //         );
    //       }

    //       return channel.id;
    //     });
    //   } else {
    //     publishGroupIds = [];
    //   }
    // }

    // if (dto.requiredChannelIds !== undefined) {
    //   if (dto.requiredChannelIds.length) {
    //     const requiredChannels =
    //       await this.channelService.getChannelsByParameters({
    //         telegramId: In(dto.requiredChannelIds),
    //       });

    //     if (requiredChannels.length !== dto.requiredChannelIds.length) {
    //       throw new NotFoundException(
    //         'Один или несколько обязательных каналов не найдены',
    //       );
    //     }

    //     const requiredChannelsMap = new Map(
    //       requiredChannels.map((channel) => [
    //         String(channel.telegramId),
    //         channel,
    //       ]),
    //     );

    //     requiredGroupIds = dto.requiredChannelIds.map((telegramId) => {
    //       const channel = requiredChannelsMap.get(String(telegramId));

    //       if (!channel) {
    //         throw new NotFoundException(
    //           `Обязательный канал с telegramId ${telegramId} не найден`,
    //         );
    //       }

    //       return channel.id;
    //     });
    //   } else {
    //     requiredGroupIds = [];
    //   }
    // }

    if (dto.winners !== undefined) {
      const resolved = await Promise.all(
        dto.winners.map((winnerId) =>
          this.usersService.findByTelegramId(winnerId.toString()),
        ),
      );

      const orderedWinners = resolved.filter(
        (user): user is User => user !== null,
      );

      await this.contestWinnerService.saveResolvedWinners(
        contestId,
        orderedWinners,
        nextPrizePlaces,
      );

      await this.contestWriteRepo.replaceWinners(
        contestId,
        orderedWinners.map((winner, index) => ({
          contestId,
          userId: winner.id,
          place: index + 1,
        })),
      );
    }

    await this.contestWriteRepo.update(contestId, {
      name: dto.name ?? contest.name,
      description: dto.description ?? contest.description,
      winnerStrategy: dto.winnerStrategy ?? contest.winnerStrategy,
      prizePlaces: nextPrizePlaces,
      startDate: nextStartDate,
      endDate: nextEndDate,
      status: dto.status ?? contest.status,
      imagePath,
      buttonText: dto.buttonText ?? contest.buttonText,
    });

    if (publishChannels !== null) {
      await this.contestWriteRepo.setPublishChannels(
        contestId,
        publishChannels.map((channel) => channel.id),
      );

      await this.recreatePendingPublications({
        contestId,
        channels: publishChannels,
        name: dto.name ?? contest.name,
        description: dto.description ?? contest.description,
        buttonText: dto.buttonText ?? contest.buttonText,
        imagePath,
      });
    }

    if (requiredChannels !== null) {
      await this.contestWriteRepo.setRequiredChannels(
        contestId,
        requiredChannels.map((channel) => channel.id),
      );
    }

    const updatedContest =
      await this.contestReadRepo.findByIdWithRelations(contestId);

    if (!updatedContest) {
      throw new NotFoundException('Конкурс не найден после обновления');
    }

    await this.syncPublishedPosts(updatedContest);

    try {
      await this.contestJobsService.scheduleContest(
        updatedContest.id,
        updatedContest.startDate,
        updatedContest.endDate,
      );
    } catch (error) {
      this.logger.error(
        { err: error, contestId: updatedContest.id },
        'Ошибка при пересоздании jobs конкурса',
      );
    }

    return updatedContest;
  }

  /**
   * Ошибка, которую стоит сохранить, но job пусть ретраится (throw в processor).
   */
  async bumpPublicationError(
    publicationId: number,
    error: string,
  ): Promise<void> {
    await this.contestWriteRepo.bumpPublicationError(publicationId, {
      error: error.slice(0, 4000),
    });
  }

  /**
   * Идемпотентное завершение конкурса (finish job).
   * MVP: просто ставим COMPLETED, позже добавим выбор победителей и уведомления.
   */
  async finishContestIdempotent(contestId: number): Promise<void> {
    const contest = await this.contestReadRepo.findByParams({ id: contestId });
    if (!contest) return;

    if (contest.status === ContestStatus.COMPLETED) return;

    const now = new Date();
    if (contest.endDate > now) return;

    const changed =
      await this.contestWriteRepo.updateStatusIfNotCompleted(contestId);
    if (!changed) return;

    await this.contestWinnerService.resolveAndSaveWinners(contest);

    const publicationIds =
      await this.getPublishedPublicationIdsForContest(contestId);

    for (const publicationId of publicationIds) {
      await this.publicationQueue.add(
        'updateFinishedButton',
        { publicationId },
        {
          jobId: `publication:${publicationId}:finish-button`,
        },
      );
    }
  }

  private async syncPublishedPosts(contest: Contest): Promise<void> {
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
          {
            contestId: contest.id,
            publicationId: publication.id,
          },
          'Пропущена синхронизация: отсутствует telegramMessageId',
        );
        continue;
      }

      if (!publication.chatId) {
        this.logger.warn(
          {
            contestId: contest.id,
            publicationId: publication.id,
          },
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
          buttonText: contest.buttonText || 'Участвовать',
          buttonUrl: `${miniAppUrl}?startapp=${publication.chatId}_${contest.id}`,
          photoUrl,
        });

        this.logger.debug(
          {
            contestId: contest.id,
            publicationId: publication.id,
            chatId: publication.chatId,
            telegramMessageId: publication.telegramMessageId,
          },
          'Опубликованный пост конкурса успешно синхронизирован',
        );
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

  getPublicationForButtonUpdate(
    publicationId: number,
  ): Promise<Pick<
    ContestPublication,
    'id' | 'contestId' | 'chatId' | 'telegramMessageId'
  > | null> {
    return this.contestReadRepo.findPublicationForButtonUpdate(publicationId);
  }

  // ✅ 2) Проверка, что конкурс завершён
  async isContestCompleted(contestId: number): Promise<boolean> {
    const contest = await this.contestReadRepo.findByParams({ id: contestId });
    return !!contest && contest.status === ContestStatus.COMPLETED;
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

  async getAllContests(
    query: GetContestsQueryDto,
  ): Promise<Paginated<Contest>> {
    return this.contestReadRepo.findMany({
      status: query.status,
      creatorId: query.creatorId,
      winnerStrategy: query.winnerStrategy,
      startDateFrom: query.startDateFrom
        ? new Date(query.startDateFrom)
        : undefined,
      startDateTo: query.startDateTo ? new Date(query.startDateTo) : undefined,
      endDateFrom: query.endDateFrom ? new Date(query.endDateFrom) : undefined,
      endDateTo: query.endDateTo ? new Date(query.endDateTo) : undefined,
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      page: query.page,
      limit: query.limit,
    });
  }

  async getAllContestsShortInfo(
    query: GetContestsQueryDto,
  ): Promise<Paginated<ContestShortInfoDto>> {
    const result = await this.contestReadRepo.findManyShortInfo({
      status: query.status,
      creatorId: query.creatorId,
      winnerStrategy: query.winnerStrategy,
      startDateFrom: query.startDateFrom
        ? new Date(query.startDateFrom)
        : undefined,
      startDateTo: query.startDateTo ? new Date(query.startDateTo) : undefined,
      endDateFrom: query.endDateFrom ? new Date(query.endDateFrom) : undefined,
      endDateTo: query.endDateTo ? new Date(query.endDateTo) : undefined,
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      page: query.page,
      limit: query.limit,
    });

    return {
      ...result,
      items: result.items.map((contest) => ({
        id: contest.id!,
        name: contest.name!,
        status: contest.status!,
        creator_userName: contest.creator?.username,
        participantCount: contest.participantsCount,
        startDate: contest.startDate!,
        endDate: contest.endDate!,
      })),
    };
  }

  async getContestById(contestId: number): Promise<Contest> {
    const contest = await this.contestReadRepo.findByIdWithRelations(contestId);

    if (!contest) {
      throw new NotFoundException('Конкурс не найден');
    }

    return contest;
  }

  private validateWinners(
    winners: { userId: number; place: number }[],
    prizePlaces: number,
  ): void {
    if (winners.length > prizePlaces) {
      throw new BadRequestException(
        'Количество победителей не может быть больше prizePlaces',
      );
    }

    const userTgIds = winners.map((w) => w.userId);
    const places = winners.map((w) => w.place);

    const uniqueUserTgIds = new Set(userTgIds);
    if (uniqueUserTgIds.size !== userTgIds.length) {
      throw new BadRequestException(
        'Один и тот же пользователь указан несколько раз',
      );
    }

    const uniquePlaces = new Set(places);
    if (uniquePlaces.size !== places.length) {
      throw new BadRequestException('Места победителей должны быть уникальны');
    }

    const invalidPlace = places.find(
      (place) => place < 1 || place > prizePlaces,
    );
    if (invalidPlace) {
      throw new BadRequestException(
        `Место победителя должно быть в диапазоне от 1 до ${prizePlaces}`,
      );
    }
  }

  async removeContest(contestId: number): Promise<void> {
    const contest = await this.contestReadRepo.findById(contestId);
    if (!contest) {
      throw new NotFoundException('Конкурс не найден');
    }

    await this.contestWriteRepo.delete(contestId);
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
    const publications =
      await this.contestReadRepo.findPublicationsByContestId(contestId);

    return publications;
  }

  async completeContest(contestId: number): Promise<Contest> {
    const contest = await this.contestReadRepo.findByIdWithRelations(contestId);

    if (!contest) {
      throw new NotFoundException('Конкурс не найден');
    }

    if (contest.status === ContestStatus.COMPLETED) {
      throw new BadRequestException('Конкурс уже завершён');
    }

    if (contest.status === ContestStatus.CANCELLED) {
      throw new BadRequestException('Нельзя завершить отменённый конкурс');
    }

    await this.contestWinnerService.resolveAndSaveWinners(contest);

    // await this.contestWinnerService.saveResolvedWinners(
    //   contest.id,
    //   winners,
    //   contest.prizePlaces,
    // );

    await this.contestWriteRepo.update(contest.id, {
      status: ContestStatus.COMPLETED,
      buttonText: 'Конкурс завершён',
    });

    const updatedContest = await this.contestReadRepo.findByIdWithRelations(
      contest.id,
    );

    if (!updatedContest) {
      throw new NotFoundException('Конкурс не найден после завершения');
    }

    await this.syncPublishedPosts(updatedContest);

    return updatedContest;
  }

  async cancelContest(id: number): Promise<Contest> {
    const contest = await this.contestReadRepo.findByIdWithRelations(id);

    if (!contest) {
      throw new NotFoundException('Конкурс не найден');
    }

    if (contest.status === ContestStatus.CANCELLED) {
      throw new BadRequestException('Конкурс уже отменён');
    }

    if (contest.status === ContestStatus.COMPLETED) {
      throw new BadRequestException('Нельзя отменить завершённый конкурс');
    }

    const hasWinners = Boolean(contest.winners?.length);

    if (hasWinners && contest.winnerStrategy !== WinnerStrategy.MANUAL) {
      throw new BadRequestException(
        'Нельзя отменить конкурс с выбранными победителями, если стратегия не manual',
      );
    }

    await this.contestJobsService.removeContestJobs(contest.id);

    // удалить уже опубликованные сообщения из Telegram
    await this.telegramService.deleteContestPublications(contest.id);

    // пометить публикации отменёнными
    await this.contestWriteRepo.cancelPendingPublications(contest.id);

    await this.contestWriteRepo.update(contest.id, {
      status: ContestStatus.CANCELLED,
    });

    const updatedContest = await this.contestReadRepo.findByIdWithRelations(id);

    if (!updatedContest) {
      throw new NotFoundException('Конкурс не найден после отмены');
    }

    return updatedContest;
  }

  private async getChannelsByTelegramIds(
    telegramIds?: number[],
    errorMessage = 'Один или несколько каналов не найдены',
  ): Promise<Channel[]> {
    if (!telegramIds?.length) {
      return [];
    }

    const channels = await this.channelService.getChannelsByParameters({
      telegramId: In(telegramIds),
    });

    if (channels.length !== telegramIds.length) {
      throw new NotFoundException(errorMessage);
    }

    const channelsMap = new Map(
      channels.map((channel) => [String(channel.telegramId), channel]),
    );

    return telegramIds.map((telegramId) => {
      const channel = channelsMap.get(String(telegramId));

      if (!channel) {
        throw new NotFoundException(
          `Канал с telegramId ${telegramId} не найден`,
        );
      }

      return channel;
    });
  }

  private buildPublicationTasks(params: {
    contestId: number;
    channels: Channel[];
    name: string;
    description?: string;
    postText?: string;
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

  private async recreatePendingPublications(params: {
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

  private resolveContestImagePath(
    image?: Express.Multer.File,
    currentImagePath?: string,
  ): string | undefined {
    if (!image) {
      return currentImagePath;
    }

    if (!image.filename) {
      throw new BadRequestException('Файл изображения загружен некорректно');
    }

    return `/uploads/contests/${image.filename}`;
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
          {
            err: error,
            contestId,
            publicationId: publication.id,
          },
          'Ошибка при обновлении кнопки счётчика участников',
        );
      }
    }
  }
}
