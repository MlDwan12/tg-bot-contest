import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FindOptionsWhere,
  IsNull,
  Not,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { Contest } from '../entities/contest.entity';
import { ContestStatus, PublicationStatus } from 'src/shared/enums/contest';
import { IContestReadFilters, IContestReadRepository } from '../interfaces';
import { ContestPublication, ContestParticipation } from '../entities';
import { Paginated } from 'src/shared/commons/response/paginated.type';
import { buildPaginatedResponse } from 'src/common/helpers/paginatedResponse.helper';

@Injectable()
export class ContestReadRepository implements IContestReadRepository {
  constructor(
    @InjectRepository(Contest)
    private readonly repo: Repository<Contest>,
    @InjectRepository(ContestPublication)
    private readonly pubRepo: Repository<ContestPublication>,
  ) {}
  findPublicationById(id: number): Promise<ContestPublication | null> {
    console.log(id);

    throw new Error('Method not implemented.');
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

  async findPublishedPublicationsByContestId(
    contestId: number,
  ): Promise<ContestPublication[]> {
    return this.pubRepo.find({
      where: {
        contestId,
        status: PublicationStatus.PUBLISHED,
      },
      relations: {
        contest: true,
      },
    });
  }

  countParticipants(contestId: number): Promise<number> {
    console.log(contestId);

    throw new Error('Method not implemented.');
  }
  findParticipantUserIds(contestId: number): Promise<number[]> {
    console.log(contestId);

    throw new Error('Method not implemented.');
  }
  findParticipations(contestId: number): Promise<ContestParticipation[]> {
    console.log(contestId);

    throw new Error('Method not implemented.');
  }

  findById(id: number): Promise<Contest | null> {
    return this.repo.findOne({
      where: { id },
    });
  }

  findByParams(params: FindOptionsWhere<Contest>): Promise<Contest | null> {
    return this.repo.findOne({
      where: params,
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
        'winnerUser.id',
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
      // либо если у тебя snake_case в БД: qb.andWhere('p.contest_id IN (:...ids)', ...)
    } else {
      qb.andWhere('p.contestId = :id', { id: contestIdOrIds });
      // либо: qb.andWhere('p.contest_id = :id', { id: contestIdOrIds })
    }

    const [sql, params] = qb.getQueryAndParameters();
    console.log('SQL:', sql);
    console.log('PARAMS:', params);

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
    // const rows = await this.pubRepo
    //   .createQueryBuilder('publication')
    //   // .select('p.id', 'id')
    //   .where('publication.contestId = :contestId', { contestId })
    //   .andWhere('publication.status = :status', {
    //     status: PublicationStatus.PUBLISHED,
    //   })
    //   .andWhere('publication.telegramMessageId IS NOT NULL')
    //   .orderBy('publication.id', 'ASC')
    //   .getRawMany<ContestPublication>();
    // return rows;
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

  // --------------------

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
