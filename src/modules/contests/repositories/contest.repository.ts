import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  FindOptionsWhere,
  In,
  IsNull,
  Not,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { Contest } from '../entities/contest.entity';
import { ContestStatus, PublicationStatus } from 'src/common/enums/contest';
import { Channel } from 'src/modules/channels/entities';
import { IContestReadFilters, IContestRepository } from '../interfaces';
import { ContestPublication, ContestWinner } from '../entities';
import { Paginated } from 'src/common/response/paginated.type';
import { buildPaginatedResponse } from 'src/common/helpers/paginatedResponse.helper';

/**
 * Единый репозиторий агрегата Contest (Фаза 9 — слиты read+write).
 * Подключается через токен CONTEST_REPOSITORY, сервисы зависят от IContestRepository.
 */
@Injectable()
export class ContestRepository implements IContestRepository {
  constructor(
    @InjectRepository(Contest)
    private readonly repo: Repository<Contest>,

    @InjectRepository(ContestPublication)
    private readonly pubRepo: Repository<ContestPublication>,

    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,

    private readonly dataSource: DataSource,
  ) {}

  // ── чтение: публикации ─────────────────────────────────────────────────────

  findPublicationById(id: number): Promise<ContestPublication | null> {
    return this.pubRepo.findOne({
      where: { id },
      relations: { channel: true },
    });
  }

  findPublicationByContestId(
    contestId: number,
  ): Promise<ContestPublication | null> {
    return this.pubRepo.findOne({
      where: { contestId },
      relations: {
        channel: true,
      },
    });
  }

  findPublicationsByContestId(
    contestId: number,
  ): Promise<ContestPublication[]> {
    return this.pubRepo.find({
      where: { contestId },
      relations: {
        channel: true,
      },
    });
  }

  // ── чтение: конкурс ─────────────────────────────────────────────────────────

  findById(id: number): Promise<Contest | null> {
    return this.repo.findOne({
      where: { id },
    });
  }

  findByParams(params: FindOptionsWhere<Contest>): Promise<Contest | null> {
    return this.repo.findOne({
      where: params,
      relations: ['requiredChannels'],
    });
  }

  async findByIdWithRelations(id: number): Promise<any | null> {
    const contest = await this.repo
      .createQueryBuilder('contest')
      .leftJoinAndSelect('contest.creator', 'creator')
      .leftJoinAndSelect('contest.publishChannels', 'publishChannels')
      .leftJoinAndSelect('contest.publications', 'publications')
      .leftJoinAndSelect('contest.requiredChannels', 'requiredChannels')
      .leftJoinAndSelect('contest.participants', 'participants')
      .leftJoinAndSelect('participants.user', 'participantsUser')
      .leftJoinAndSelect('contest.winners', 'winners')
      .leftJoinAndSelect('winners.user', 'winnerUser')
      .where('contest.id = :id', { id })
      .select([
        'contest',
        'creator',
        'publishChannels',
        'publications.id',
        'publications.chatId',
        'publications.telegramMessageId',
        'publications.payload',
        'requiredChannels',
        'participants.id',
        'participants.groupId',
        'participants.isWinner',
        'participants.prizePlace',
        'participants.joinedAt',
        'participantsUser.id',
        'participantsUser.telegramId',
        'participantsUser.username',
        'winners.id',
        'winners.userId',
        'winnerUser.id',
        'winners.place',
        'winnerUser.telegramId',
        'winnerUser.username',
      ])
      .getOne();

    if (!contest) {
      return null;
    }

    return {
      id: contest.id,
      publishChannels:
        contest.publishChannels?.map((channel) => ({
          telegramId: channel.telegramId,
          telegramUsername: channel.telegramUsername,
        })) ?? [],
      requiredChannels:
        contest.requiredChannels?.map((channel) => ({
          telegramId: channel.telegramId,
          telegramUsername: channel.telegramUsername,
        })) ?? [],
      creator: contest.creator ? contest.creator.username : null,
      name: contest.name,
      description: contest.description ?? null,
      imagePath: contest.imagePath ?? null,
      buttonText: contest.buttonText ?? null,
      participants:
        contest.participants?.map((participant) => ({
          id: participant.id,
          groupId: participant.groupId ?? null,
          isWinner: participant.isWinner,
          prizePlace: participant.prizePlace ?? null,
          joinedAt: participant.joinedAt ?? null,
          user: participant.user
            ? {
                id: participant.user.id,
                telegramId: participant.user.telegramId ?? null,
                username: participant.user.username ?? null,
              }
            : null,
        })) ?? [],
      publications:
        contest.publications?.map((publication) => ({
          id: publication.id,
          chatId: publication.chatId,
          telegramMessageId: publication.telegramMessageId ?? null,
          payload: {
            buttonUrl: publication.payload?.buttonUrl ?? '',
            buttonText: publication.payload?.buttonText ?? '',
          },
        })) ?? [],
      winnerStrategy: contest.winnerStrategy,
      prizePlaces: contest.prizePlaces,
      winners:
        contest.winners?.map((winner) => ({
          id: winner.id,
          userId: winner.userId,
          place: winner.place,
          user: winner.user
            ? {
                id: winner.user.id,
                telegramId: winner.user.telegramId ?? null,
                username: winner.user.username ?? null,
              }
            : null,
        })) ?? [],
      createdAt: contest.createdAt,
      startDate: contest.startDate,
      endDate: contest.endDate,
      status: contest.status,
    };
  }

  async findMany(filters?: IContestReadFilters): Promise<Paginated<Contest>> {
    const qb = this.repo.createQueryBuilder('contest');

    this.applyFilters(qb, filters);
    this.applySorting(qb, filters);
    this.applyPagination(qb, filters);

    const [items, total] = await qb.getManyAndCount();

    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 10;

    return buildPaginatedResponse({
      items,
      total,
      page,
      limit,
    });
  }

  findByStatus(status: ContestStatus): Promise<Contest[]> {
    return this.repo.find({
      where: { status },
    });
  }

  async getPublicationIdsByStatus(
    contestIdOrIds: number | number[],
    status: PublicationStatus,
  ): Promise<number[]> {
    const qb = this.pubRepo
      .createQueryBuilder('p')
      .select('p.id', 'id')
      .where('p.status = :status', { status });

    if (Array.isArray(contestIdOrIds)) {
      qb.andWhere('p.contestId IN (:...ids)', { ids: contestIdOrIds });
    } else {
      qb.andWhere('p.contestId = :id', { id: contestIdOrIds });
    }

    const rows = await qb.orderBy('p.id', 'ASC').getRawMany<{ id: number }>();
    return rows.map((r) => Number(r.id));
  }

  findActive(): Promise<Contest[]> {
    return this.repo
      .createQueryBuilder('contest')
      .where('contest.startDate <= NOW()')
      .andWhere('contest.endDate >= NOW()')
      .getMany();
  }

  findFinished(): Promise<Contest[]> {
    return this.repo
      .createQueryBuilder('contest')
      .where('contest.endDate < NOW()')
      .getMany();
  }

  async findPublicationForButtonUpdate(publicationId: number): Promise<{
    id: number;
    contestId: number;
    chatId: number;
    telegramMessageId?: number;
  } | null> {
    return this.pubRepo.findOne({
      where: { id: publicationId },
      select: {
        id: true,
        contestId: true,
        chatId: true,
        telegramMessageId: true,
      },
    });
  }

  async findPublishedPublicationIdsForContest(
    contestId: number,
  ): Promise<ContestPublication[]> {
    return this.pubRepo.find({
      where: {
        contestId,
        status: PublicationStatus.PUBLISHED,
        telegramMessageId: Not(IsNull()),
      },
      order: { id: 'ASC' },
    });
  }

  async findManyShortInfo(
    filters?: IContestReadFilters,
  ): Promise<Paginated<Partial<any>>> {
    const qb = this.repo
      .createQueryBuilder('contest')
      .leftJoinAndSelect('contest.creator', 'creator')
      .loadRelationCountAndMap(
        'contest.participantsCount',
        'contest.participants',
      )
      .select([
        'contest.id',
        'contest.name',
        'contest.startDate',
        'contest.endDate',
        'contest.status',
        'contest.createdAt',
        'creator.id',
        'creator.username',
      ])
      .orderBy('contest.startDate', 'DESC');

    this.applyFilters(qb, filters);
    this.applySorting(qb, filters);
    this.applyPagination(qb, filters);

    const [items, total] = await qb.getManyAndCount();
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 10;

    return buildPaginatedResponse({
      items,
      total,
      page,
      limit,
    });
  }

  // ── запись: конкурс ─────────────────────────────────────────────────────────

  async create(data: Partial<Contest>): Promise<Contest> {
    const contest = this.repo.create(data);
    return this.repo.save(contest);
  }

  async update(id: number, data: Partial<Contest>): Promise<Contest> {
    await this.ensureExists(id);

    await this.repo.update(id, data);

    return this.repo.findOneByOrFail({ id });
  }

  async delete(id: number): Promise<void> {
    await this.ensureExists(id);
    await this.repo.delete(id);
  }

  async setStatus(id: number, status: ContestStatus): Promise<void> {
    await this.ensureExists(id);

    await this.repo.update(id, { status });
  }

  /**
   * Идемпотентный апдейт статуса: обновит только если текущий статус совпадает.
   * Возвращает true если реально обновил, false если нет.
   */
  async updateStatusIfCurrent(
    contestId: number,
    current: ContestStatus,
    next: ContestStatus,
  ): Promise<boolean> {
    const res = await this.repo
      .createQueryBuilder()
      .update(Contest)
      .set({ status: next })
      .where('"id" = :id', { id: contestId })
      .andWhere('"status" = :current', { current })
      .execute();

    return (res.affected ?? 0) > 0;
  }

  /**
   * Переводит в COMPLETED, только если ещё не COMPLETED.
   * Возвращает true если обновил.
   */
  async updateStatusIfNotCompleted(contestId: number): Promise<boolean> {
    const res = await this.repo
      .createQueryBuilder()
      .update(Contest)
      .set({ status: ContestStatus.COMPLETED })
      .where('"id" = :id', { id: contestId })
      .andWhere('"status" != :completed', {
        completed: ContestStatus.COMPLETED,
      })
      .execute();

    return (res.affected ?? 0) > 0;
  }

  async setPublishChannels(
    contestId: number,
    channelIds: number[],
  ): Promise<void> {
    const contest = await this.repo.findOne({
      where: { id: contestId },
      relations: { publishChannels: true },
    });

    if (!contest) {
      throw new NotFoundException('Contest not found');
    }

    const uniqueIds = [...new Set(channelIds)];
    const channels = uniqueIds.length
      ? await this.channelRepo.find({
          where: { id: In(uniqueIds) },
        })
      : [];

    if (channels.length !== uniqueIds.length) {
      throw new NotFoundException('One or more publish channels not found');
    }

    contest.publishChannels = channels;
    await this.repo.save(contest);
  }

  async setRequiredChannels(
    contestId: number,
    channelIds: number[],
  ): Promise<void> {
    const contest = await this.repo.findOne({
      where: { id: contestId },
      relations: { requiredChannels: true },
    });

    if (!contest) {
      throw new NotFoundException('Contest not found');
    }

    const uniqueIds = [...new Set(channelIds)];
    const channels = uniqueIds.length
      ? await this.channelRepo.find({
          where: { id: In(uniqueIds) },
        })
      : [];

    if (channels.length !== uniqueIds.length) {
      throw new NotFoundException('One or more required channels not found');
    }

    contest.requiredChannels = channels;
    await this.repo.save(contest);
  }

  async replaceWinners(
    contestId: number,
    winners: Array<{
      contestId: number;
      userId: number;
      place: number;
    }>,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // удалить старых победителей
      await manager.delete(ContestWinner, { contestId });

      // если передали новых — вставить
      if (winners.length) {
        await manager.insert(ContestWinner, winners);
      }
    });
  }

  // ── запись: публикации ──────────────────────────────────────────────────────

  async createPublications(data: Partial<ContestPublication>[]): Promise<void> {
    if (!data.length) return;

    await this.pubRepo.insert(data);
  }

  /**
   * Атомарно "забирает" публикацию в обработку: PENDING -> PROCESSING.
   * Если запись уже забрал другой воркер/не PENDING, вернёт null.
   */
  async claimPublication(
    publicationId: number,
  ): Promise<ContestPublication | null> {
    const res = await this.pubRepo
      .createQueryBuilder()
      .update(ContestPublication)
      .set({
        status: PublicationStatus.PROCESSING,
        attempts: () => `"attempts" + 1`,
        processingStartedAt: () => 'NOW()',
      })
      .where('"id" = :id', { id: publicationId })
      .andWhere('"status" = :st', { st: PublicationStatus.PENDING })
      .returning('*')
      .execute();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return res.raw?.[0] ?? null;
  }

  async markPublicationPublished(
    publicationId: number,
    data: { telegramMessageId: number; publishedAt: Date },
  ): Promise<void> {
    await this.pubRepo.update(publicationId, {
      status: PublicationStatus.PUBLISHED,
      telegramMessageId: data.telegramMessageId,
      publishedAt: data.publishedAt,
      error: undefined,
    });
  }

  async markPublicationFailed(
    publicationId: number,
    data: { error: string },
  ): Promise<void> {
    await this.pubRepo.update(publicationId, {
      status: PublicationStatus.FAILED,
      error: data.error,
    });
  }

  /**
   * Обновляет error и возвращает публикацию обратно в PENDING (для retry).
   */
  async bumpPublicationError(
    publicationId: number,
    data: { error: string },
  ): Promise<void> {
    await this.pubRepo.update(publicationId, {
      status: PublicationStatus.PENDING,
      error: data.error,
      processingStartedAt: undefined,
    });
  }

  async requeueStalePublications(staleMinutes: number): Promise<number> {
    const res = await this.pubRepo
      .createQueryBuilder()
      .update(ContestPublication)
      .set({
        status: PublicationStatus.PENDING,
        processingStartedAt: undefined,
      })
      .where('"status" = :st', { st: PublicationStatus.PROCESSING })
      .andWhere('"processingStartedAt" IS NOT NULL')
      .andWhere(
        `"processingStartedAt" < NOW() - (:mins * INTERVAL '1 minute')`,
        {
          mins: staleMinutes,
        },
      )
      .execute();

    return res.affected ?? 0;
  }

  async findPendingPublicationIdsForActiveContests(
    limit: number,
  ): Promise<number[]> {
    const rows = await this.pubRepo
      .createQueryBuilder('p')
      .select('p.id', 'id')
      .innerJoin('p.contest', 'c')
      .where('p.status = :pst', { pst: PublicationStatus.PENDING })
      .andWhere('c.status = :cst', { cst: ContestStatus.ACTIVE })
      .orderBy('p.id', 'ASC')
      .limit(Math.max(1, Math.min(limit, 5000)))
      .getRawMany<{ id: number }>();

    return rows.map((r) => Number(r.id));
  }

  async cancelPendingPublications(contestId: number): Promise<void> {
    await this.pubRepo
      .createQueryBuilder()
      .update(ContestPublication)
      .set({ status: PublicationStatus.CANCELLED })
      .where('"contestId" = :contestId', { contestId })
      .andWhere('status IN (:...statuses)', {
        statuses: [
          PublicationStatus.PENDING,
          PublicationStatus.FAILED,
          PublicationStatus.PUBLISHED,
        ],
      })
      .execute();
  }

  async deletePendingPublicationsByContestId(contestId: number): Promise<void> {
    await this.pubRepo.delete({
      contestId,
      status: PublicationStatus.PENDING,
    });
  }

  async findPublishedPublicationsByContestId(
    contestId: number,
  ): Promise<ContestPublication[]> {
    return this.pubRepo.find({
      where: {
        contestId,
        status: PublicationStatus.PUBLISHED,
      },
      relations: {
        channel: true,
      },
    });
  }

  async updatePublication(
    publicationId: number,
    data: Partial<ContestPublication>,
  ): Promise<void> {
    await this.pubRepo.update(publicationId, data);
  }

  // ── приватное ───────────────────────────────────────────────────────────────

  private async ensureExists(id: number): Promise<void> {
    const exists = await this.repo.findOne({ where: { id } });

    if (!exists) {
      throw new NotFoundException(`Contest with id=${id} not found`);
    }
  }

  private applyFilters(
    qb: SelectQueryBuilder<Contest>,
    filters?: IContestReadFilters,
  ) {
    if (!filters) return;

    if (filters.status) {
      qb.andWhere('contest.status = :status', {
        status: filters.status,
      });
    }

    if (filters.creatorId) {
      qb.andWhere('contest.creatorId = :creatorId', {
        creatorId: filters.creatorId,
      });
    }

    if (filters.winnerStrategy) {
      qb.andWhere('contest.winnerStrategy = :winnerStrategy', {
        winnerStrategy: filters.winnerStrategy,
      });
    }

    if (filters.startDateFrom) {
      qb.andWhere('contest.startDate >= :startDateFrom', {
        startDateFrom: filters.startDateFrom,
      });
    }

    if (filters.startDateTo) {
      qb.andWhere('contest.startDate <= :startDateTo', {
        startDateTo: filters.startDateTo,
      });
    }

    if (filters.endDateFrom) {
      qb.andWhere('contest.endDate >= :endDateFrom', {
        endDateFrom: filters.endDateFrom,
      });
    }

    if (filters.endDateTo) {
      qb.andWhere('contest.endDate <= :endDateTo', {
        endDateTo: filters.endDateTo,
      });
    }

    if (filters.search) {
      qb.andWhere(
        '(LOWER(contest.name) LIKE LOWER(:search) OR LOWER(contest.description) LIKE LOWER(:search))',
        {
          search: `%${filters.search}%`,
        },
      );
    }
  }

  private applySorting(
    qb: SelectQueryBuilder<Contest>,
    filters?: IContestReadFilters,
  ) {
    const sortBy = filters?.sortBy ?? 'createdAt';
    const sortOrder = filters?.sortOrder ?? 'DESC';

    const allowedSortFields: Record<string, string> = {
      createdAt: 'contest.createdAt',
      startDate: 'contest.startDate',
      endDate: 'contest.endDate',
      name: 'contest.name',
      status: 'contest.status',
    };

    qb.orderBy(
      allowedSortFields[sortBy] ?? 'contest.createdAt',
      sortOrder === 'ASC' ? 'ASC' : 'DESC',
    );
  }

  private applyPagination(
    qb: SelectQueryBuilder<Contest>,
    filters?: IContestReadFilters,
  ) {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 10;

    const skip = (page - 1) * limit;

    qb.skip(skip).take(limit);
  }
}
