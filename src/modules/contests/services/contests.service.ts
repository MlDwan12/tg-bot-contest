import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CONTEST_REPOSITORY } from 'src/common/constants';
import type { IContestRepository } from '../interfaces';
import {
  CreateContest,
  ContestWithRelations,
} from 'src/modules/contests/types';
import { Contest } from '../entities';
import { ContestStatus, WinnerStrategy } from 'src/common/enums/contest';
import { AdminService } from 'src/modules/users/services';
import { Logger } from 'nestjs-pino';
import { ChannelsService } from 'src/modules/channels/services';
import { ContestJobsService } from './contest-jobs.service';
import { GetContestsQueryDto } from '../dto/get-contests-query.dto';
import { Paginated } from 'src/common/response/paginated.type';
import { ContestShortInfoDto } from '../dto/contest-short-info.dto';
import { UpdateContestDto } from '../dto';
import { In } from 'typeorm';
import { UsersService } from '../../users/services/users.service';
import { User } from 'src/modules/users/entities';
import { Channel } from 'src/modules/channels/entities';
import { fromZonedTime } from 'date-fns-tz';
import { deleteUploadedContestImage } from 'src/common/helpers/remove-image.helper';
import { deleteContestImageByPath } from 'src/common/helpers/deleteContestImageByPath.helper';
import { ContestPublicationService } from './contest-publication.service';
import { ContestWinnerService } from './contest-winner.service';

@Injectable()
export class ContestsService {
  private readonly APP_TIME_ZONE = 'Europe/Moscow';

  constructor(
    @Inject(CONTEST_REPOSITORY)
    private readonly contestRepo: IContestRepository,

    private readonly adminService: AdminService,
    private readonly logger: Logger,
    private readonly channelService: ChannelsService,
    private readonly contestJobsService: ContestJobsService,
    private readonly contestPublicationService: ContestPublicationService,
    private readonly usersService: UsersService,
    private readonly contestWinnerService: ContestWinnerService,
  ) {}

  async createContest(
    dto: CreateContest,
    image?: Express.Multer.File,
  ): Promise<ContestWithRelations> {
    this.logger.debug('createContest: start');

    const startDate = fromZonedTime(dto.startDate, this.APP_TIME_ZONE);
    const endDate = fromZonedTime(dto.endDate, this.APP_TIME_ZONE);
    const now = new Date();

    const buttonText = dto.buttonText?.trim() || 'Участвовать';

    await this.assertCreatableContestDates(startDate, endDate, now, image);

    try {
      return await this.persistNewContest(
        dto,
        image,
        startDate,
        endDate,
        buttonText,
      );
    } catch (error) {
      await deleteUploadedContestImage(image);

      this.logger.error(
        {
          error,
          creatorId: dto.creatorId,
          publishChannelIds: dto.publishChannelIds,
          requiredChannelIds: dto.requiredChannelIds,
        },
        'Ошибка при создании конкурса',
      );

      throw error;
    }
  }

  async updateContest(
    contestId: number,
    dto: UpdateContestDto,
    image?: Express.Multer.File,
    actorUserId?: number,
  ): Promise<ContestWithRelations> {
    const contest = await this.contestRepo.findByIdWithRelations(contestId);

    this.logger.debug({ contestId, dto }, 'Запрос на обновление конкурса');

    if (!contest) {
      await deleteUploadedContestImage(image);
      throw new NotFoundException('Конкурс не найден');
    }

    const nextStartDate = dto.startDate
      ? this.parseContestDate(dto.startDate)
      : contest.startDate;

    const nextEndDate = dto.endDate
      ? this.parseContestDate(dto.endDate)
      : contest.endDate;

    const now = new Date();

    await this.assertContestEditable(
      contest,
      dto,
      nextStartDate,
      nextEndDate,
      now,
      image,
    );

    const datesChanged =
      nextStartDate.getTime() !== new Date(contest.startDate).getTime() ||
      nextEndDate.getTime() !== new Date(contest.endDate).getTime();

    const nextPrizePlaces = dto.prizePlaces ?? contest.prizePlaces;
    const nextWinnerStrategy = dto.winnerStrategy ?? contest.winnerStrategy;
    const imagePath = this.resolveContestImagePath(
      image,
      contest.imagePath ?? undefined,
    );
    const oldImagePath = contest.imagePath;

    const nextName = dto.name?.trim() || contest.name;
    const nextDescription =
      dto.description !== undefined
        ? dto.description?.trim() || undefined
        : (contest.description ?? undefined);
    const nextButtonText =
      dto.buttonText !== undefined
        ? dto.buttonText.trim() || 'Участвовать'
        : contest.buttonText || 'Участвовать';

    let contestUpdated = false;
    try {
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

      await this.applyManualWinnersUpdate(
        contestId,
        contest,
        dto,
        nextWinnerStrategy,
        nextPrizePlaces,
        actorUserId,
      );

      await this.contestRepo.update(contestId, {
        name: nextName,
        description: nextDescription,
        winnerStrategy: nextWinnerStrategy,
        prizePlaces: nextPrizePlaces,
        startDate: nextStartDate,
        endDate: nextEndDate,
        status: dto.status ?? contest.status,
        imagePath,
        buttonText: nextButtonText,
        recheckSubscriptionOnFinish:
          dto.recheckSubscriptionOnFinish ??
          contest.recheckSubscriptionOnFinish,
      });
      contestUpdated = true;

      if (publishChannels !== null) {
        await this.contestRepo.setPublishChannels(
          contestId,
          publishChannels.map((channel) => channel.id),
        );
      }

      if (requiredChannels !== null) {
        await this.contestRepo.setRequiredChannels(
          contestId,
          requiredChannels.map((channel) => channel.id),
        );
      }

      const updatedContest =
        await this.contestRepo.findByIdWithRelations(contestId);

      if (!updatedContest) {
        throw new NotFoundException('Конкурс не найден после обновления');
      }

      if (datesChanged) {
        try {
          await this.contestJobsService.rescheduleContest(
            updatedContest.id,
            updatedContest.startDate,
            updatedContest.endDate,
          );
        } catch (error) {
          this.logger.error(
            {
              err: error,
              contestId: updatedContest.id,
              startDate: updatedContest.startDate,
              endDate: updatedContest.endDate,
              status: updatedContest.status,
            },
            'Ошибка при перепланировании jobs конкурса',
          );
          throw error;
        }
      }

      try {
        await this.contestPublicationService.syncPublishedPosts(updatedContest);
      } catch (error) {
        this.logger.error(
          { err: error, contestId: updatedContest.id },
          'Ошибка при синхронизации опубликованных постов',
        );
      }

      const shouldRefreshPendingPublications =
        contest.status === ContestStatus.PENDING &&
        (dto.publishChannelIds !== undefined ||
          dto.name !== undefined ||
          dto.description !== undefined ||
          dto.buttonText !== undefined ||
          image !== undefined);

      if (shouldRefreshPendingPublications) {
        const channels =
          publishChannels ??
          (Array.isArray(updatedContest.publishChannels) &&
          updatedContest.publishChannels.length
            ? await this.getChannelsByTelegramIds(
                updatedContest.publishChannels.map((channel) =>
                  Number(channel.telegramId),
                ),
                'Один или несколько каналов публикации не найдены',
              )
            : []);

        this.logger.debug(
          {
            contestId,
            channelsCount: channels.length,
            imagePath: updatedContest.imagePath,
          },
          'Before recreatePendingPublications',
        );

        try {
          await this.contestPublicationService.recreatePendingPublications({
            contestId,
            channels,
            name: updatedContest.name,
            description: updatedContest.description ?? undefined,
            buttonText: updatedContest.buttonText ?? undefined,
            imagePath: updatedContest.imagePath ?? undefined,
          });
        } catch (error) {
          this.logger.error(
            { err: error, contestId, imagePath: updatedContest.imagePath },
            'Ошибка при пересоздании pending publications',
          );
          throw error;
        }
      }

      if (image && oldImagePath && oldImagePath !== imagePath) {
        await deleteContestImageByPath(oldImagePath);
      }

      return updatedContest;
    } catch (error) {
      if (!contestUpdated) {
        await deleteUploadedContestImage(image);
      }

      this.logger.error(
        { err: error, contestId, dto },
        'Ошибка при обновлении конкурса',
      );

      throw error;
    }
  }

  async getAllContests(
    query: GetContestsQueryDto,
  ): Promise<Paginated<Contest>> {
    return this.contestRepo.findMany({
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
    const result = await this.contestRepo.findManyShortInfo({
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

  async getContestById(contestId: number): Promise<ContestWithRelations> {
    const contest = await this.contestRepo.findByIdWithRelations(contestId);

    if (!contest) {
      throw new NotFoundException('Конкурс не найден');
    }

    return contest;
  }

  async getByStatus(status: ContestStatus): Promise<Paginated<Contest>> {
    return this.contestRepo.findMany({ status });
  }

  async getActiveContestById(contestId: number): Promise<Contest> {
    const contest = await this.contestRepo.findByParams({
      id: contestId,
      status: ContestStatus.ACTIVE,
    });

    if (!contest) {
      throw new NotFoundException('Конкурс не найден или завершен');
    }

    return contest;
  }

  async removeContest(contestId: number): Promise<void> {
    const contest = await this.contestRepo.findById(contestId);

    if (!contest) {
      throw new NotFoundException('Конкурс не найден');
    }

    if (contest.status === ContestStatus.ACTIVE) {
      throw new BadRequestException('Невозможно удалить активный конкурс');
    }

    await this.contestRepo.delete(contestId);
  }

  /** Валидация дат нового конкурса (до старта транзакции). Очистка картинки 1:1. */
  private async assertCreatableContestDates(
    startDate: Date,
    endDate: Date,
    now: Date,
    image?: Express.Multer.File,
  ): Promise<void> {
    if (startDate >= endDate) {
      await deleteUploadedContestImage(image);
      throw new BadRequestException('startDate must be before endDate');
    }

    if (startDate <= now) {
      await deleteUploadedContestImage(image);
      throw new BadRequestException('startDate must be in the future');
    }

    if (endDate <= now) {
      await deleteUploadedContestImage(image);
      throw new BadRequestException('endDate must be in the future');
    }
  }

  /** Создание конкурса + каналы + публикации + джобы. Тело прежнего try 1:1. */
  private async persistNewContest(
    dto: CreateContest,
    image: Express.Multer.File | undefined,
    startDate: Date,
    endDate: Date,
    buttonText: string,
  ): Promise<ContestWithRelations> {
    const creator = await this.adminService.findById(dto.creatorId);

    if (!creator) {
      throw new NotFoundException('Creator not found');
    }

    const publishChannels = await this.getChannelsByTelegramIds(
      dto.publishChannelIds,
      'Один или несколько каналов публикации не найдены',
    );

    const requiredChannels = await this.getChannelsByTelegramIds(
      dto.requiredChannelIds,
      'Один или несколько обязательных каналов не найдены',
    );

    await this.contestPublicationService.validateBotPermissionsForPublishChannels(
      publishChannels,
    );

    const imagePath = this.resolveContestImagePath(image);

    const contest = await this.contestRepo.create({
      name: dto.name.trim(),
      description: dto.description?.trim(),
      winnerStrategy: dto.winnerStrategy,
      prizePlaces: dto.prizePlaces,
      startDate,
      endDate,
      status: ContestStatus.PENDING,
      creatorId: dto.creatorId,
      imagePath,
      buttonText,
      recheckSubscriptionOnFinish: dto.recheckSubscriptionOnFinish ?? true,
    });

    await this.contestRepo.setPublishChannels(
      contest.id,
      publishChannels.map((channel) => channel.id),
    );

    await this.contestRepo.setRequiredChannels(
      contest.id,
      requiredChannels.map((channel) => channel.id),
    );

    await this.contestPublicationService.recreatePendingPublications({
      contestId: contest.id,
      channels: publishChannels,
      name: dto.name.trim(),
      description: dto.description?.trim(),
      buttonText,
      imagePath,
    });

    await this.contestJobsService.scheduleContest(
      contest.id,
      contest.startDate,
      contest.endDate,
    );

    const createdContest = await this.contestRepo.findByIdWithRelations(
      contest.id,
    );

    if (!createdContest) {
      throw new NotFoundException(
        `Созданный конкурс id=${contest.id} не удалось прочитать`,
      );
    }

    return createdContest;
  }

  /**
   * Гварды редактируемости конкурса (существование проверяется у вызывающего).
   * Каждый отказ чистит загруженную картинку — поведение прежних inline-гвардов 1:1.
   */
  private async assertContestEditable(
    contest: ContestWithRelations,
    dto: UpdateContestDto,
    nextStartDate: Date,
    nextEndDate: Date,
    now: Date,
    image?: Express.Multer.File,
  ): Promise<void> {
    if (contest.status === ContestStatus.COMPLETED) {
      await deleteUploadedContestImage(image);
      throw new BadRequestException('Нельзя редактировать завершённый конкурс');
    }

    if (contest.status === ContestStatus.CANCELLED) {
      await deleteUploadedContestImage(image);
      throw new BadRequestException('Нельзя редактировать отменённый конкурс');
    }

    if (
      dto.startDate !== undefined &&
      contest.status === ContestStatus.ACTIVE
    ) {
      await deleteUploadedContestImage(image);
      throw new BadRequestException(
        'Нельзя изменить дату начала активного конкурса',
      );
    }

    if (dto.endDate !== undefined && nextEndDate <= now) {
      await deleteUploadedContestImage(image);
      throw new BadRequestException('endDate must be in the future');
    }

    if (dto.startDate !== undefined && nextStartDate <= now) {
      await deleteUploadedContestImage(image);
      throw new BadRequestException('startDate must be in the future');
    }

    if (nextStartDate >= nextEndDate) {
      await deleteUploadedContestImage(image);
      throw new BadRequestException('startDate must be before endDate');
    }

    if (
      dto.publishChannelIds !== undefined &&
      contest.status !== ContestStatus.PENDING
    ) {
      await deleteUploadedContestImage(image);
      throw new BadRequestException(
        'Нельзя менять каналы публикации после запуска конкурса',
      );
    }
  }

  /**
   * MANUAL-назначение победителей при обновлении (характеризовано Ф10.3).
   * Тело прежнего winners-блока перенесено 1:1.
   */
  private async applyManualWinnersUpdate(
    contestId: number,
    contest: ContestWithRelations,
    dto: UpdateContestDto,
    nextWinnerStrategy: WinnerStrategy,
    nextPrizePlaces: number,
    actorUserId?: number,
  ): Promise<void> {
    if (
      dto.winners !== undefined &&
      dto.winners.length > 0 &&
      nextWinnerStrategy !== WinnerStrategy.MANUAL
    ) {
      throw new BadRequestException(
        'Нельзя назначить победителей вручную при стратегии, отличной от manual',
      );
    }

    if (nextWinnerStrategy === WinnerStrategy.MANUAL) {
      if (dto.winners !== undefined) {
        if (contest.status === ContestStatus.PENDING) {
          throw new BadRequestException(
            'Нельзя назначить победителей до старта конкурса',
          );
        }

        if (dto.winners.length === 0) {
          await this.contestRepo.replaceWinners(contestId, []);
        } else {
          const rows = await this.resolveManualWinnerRows(
            dto.winners,
            nextPrizePlaces,
          );

          await this.contestRepo.replaceWinners(
            contestId,
            rows.map((row, index) => ({
              contestId,
              userId: row.userId,
              displayUsername: row.displayUsername,
              place: index + 1,
            })),
          );

          // Аудит подотчётности (Q5.2), best-effort: назначение уже
          // выполнено выше — если запись следа упадёт, не ломаем операцию,
          // только громко логируем. Реальные победители → winnerUserIds,
          // выдуманные ники (userId нет) → в note.
          try {
            await this.contestWinnerService.recordManualAssignment(
              contestId,
              rows
                .filter((row) => row.userId !== null)
                .map((row) => row.userId as number),
              nextPrizePlaces,
              actorUserId,
              rows
                .filter((row) => row.userId === null)
                .map((row) => row.displayUsername as string),
            );
          } catch (error) {
            this.logger.error(
              { err: error, contestId, actorUserId },
              'Не удалось записать аудит MANUAL-назначения победителей',
            );
          }
        }
      }
    } else {
      if (
        dto.winnerStrategy !== undefined &&
        dto.winnerStrategy !== WinnerStrategy.MANUAL
      ) {
        await this.contestRepo.replaceWinners(contestId, []);
      }
    }
  }

  /**
   * Классификация + валидация ручного списка победителей → упорядоченные строки
   * (place = индекс + 1). Реальный (telegramId) резолвится в юзера (не найден →
   * 404); фиктивный (username) — ник без TG-аккаунта, userId = null.
   */
  private async resolveManualWinnerRows(
    winners: NonNullable<UpdateContestDto['winners']>,
    prizePlaces: number,
  ): Promise<Array<{ userId: number | null; displayUsername: string | null }>> {
    type Classified =
      | { kind: 'real'; telegramId: number }
      | { kind: 'fictitious'; nick: string };

    const classified: Classified[] = winners.map((winner) => {
      const hasTelegramId =
        winner.telegramId !== undefined && winner.telegramId !== null;
      const hasUsername =
        winner.username !== undefined && winner.username !== null;

      if (hasTelegramId && hasUsername) {
        throw new BadRequestException(
          'У победителя нужно указать либо telegramId, либо ник, но не оба',
        );
      }

      if (hasTelegramId) {
        return { kind: 'real', telegramId: Number(winner.telegramId) };
      }

      if (hasUsername) {
        const nick = String(winner.username).trim().replace(/^@+/, '').trim();
        if (!nick) {
          throw new BadRequestException('Ник победителя не может быть пустым');
        }
        return { kind: 'fictitious', nick };
      }

      throw new BadRequestException(
        'У победителя не указан ни telegramId, ни ник',
      );
    });

    // Дубли: реальные — по telegramId, фиктивные — по нику (регистронезависимо,
    // TG-ники case-insensitive).
    const telegramIds: number[] = [];
    const nickKeys: string[] = [];
    for (const item of classified) {
      if (item.kind === 'real') {
        telegramIds.push(item.telegramId);
      } else {
        nickKeys.push(item.nick.toLowerCase());
      }
    }

    if (
      new Set(telegramIds).size !== telegramIds.length ||
      new Set(nickKeys).size !== nickKeys.length
    ) {
      throw new BadRequestException('Список победителей содержит дубликаты');
    }

    if (classified.length !== prizePlaces) {
      throw new BadRequestException(
        'Количество победителей должно соответствовать количеству призовых мест',
      );
    }

    // Реальных резолвим в юзеров; ников НЕ ищем (в этом суть фичи).
    const resolvedUsers = await Promise.all(
      classified.map((item) =>
        item.kind === 'real'
          ? this.usersService.findByTelegramId(item.telegramId.toString())
          : Promise.resolve(null),
      ),
    );

    const notFound: number[] = [];
    classified.forEach((item, index) => {
      if (item.kind === 'real' && !resolvedUsers[index]) {
        notFound.push(item.telegramId);
      }
    });

    if (notFound.length) {
      throw new NotFoundException(
        `Не найдены пользователи с telegramId: ${notFound.join(', ')}`,
      );
    }

    return classified.map((item, index) =>
      item.kind === 'real'
        ? { userId: (resolvedUsers[index] as User).id, displayUsername: null }
        : { userId: null, displayUsername: item.nick },
    );
  }

  private async getChannelsByTelegramIds(
    telegramIds?: number[],
    errorMessage = 'Один или несколько каналов не найдены',
  ): Promise<Channel[]> {
    if (!telegramIds?.length) {
      return [];
    }

    const uniqueTelegramIds = [...new Set(telegramIds)];

    if (uniqueTelegramIds.length !== telegramIds.length) {
      throw new BadRequestException(
        'Список каналов содержит дублирующиеся telegramId',
      );
    }

    const channels = await this.channelService.getChannelsByParameters({
      telegramId: In(uniqueTelegramIds),
    });

    if (channels.length !== uniqueTelegramIds.length) {
      throw new NotFoundException(errorMessage);
    }

    const channelsMap = new Map(
      channels.map((channel) => [String(channel.telegramId), channel]),
    );

    return uniqueTelegramIds.map((telegramId) => {
      const channel = channelsMap.get(String(telegramId));

      if (!channel) {
        throw new NotFoundException(
          `Канал с telegramId ${telegramId} не найден`,
        );
      }

      return channel;
    });
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

  private parseContestDate(date: string | Date): Date {
    const source =
      date instanceof Date
        ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}`
        : date;

    return fromZonedTime(source, this.APP_TIME_ZONE);
  }
}
