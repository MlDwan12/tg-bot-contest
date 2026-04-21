import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { User } from '../entities';
import { IUserReadRepository } from '../interfaces';
import { UserRole } from 'src/shared/enums/user';
import { UserListItemDto } from '../dto/user-list-item.dto';
import { UserDetailsDto } from '../dto/get-user-details.dto';
import { Channel } from 'src/modules/channels/entities';
import { Logger } from 'nestjs-pino';

@Injectable()
export class UserReadRepository implements IUserReadRepository {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
    private readonly logger: Logger,
  ) {}

  findById(id: number): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  findOne(filters: FindOptionsWhere<User>): Promise<User | null> {
    return this.repo.findOne({ where: filters });
  }

  findByLogin(login: string): Promise<User | null> {
    return this.repo.findOne({ where: { login } });
  }

  findByTelegramId(telegramId: string): Promise<User | null> {
    return this.repo.findOne({ where: { telegramId } });
  }

  findAll(): Promise<User[]> {
    return this.repo.find();
  }

  findAllByParams(params: FindOptionsWhere<User>): Promise<User[]> {
    return this.repo.find({ where: params });
  }

  async findAllUsersWithParticipationCount(params: {
    skip: number;
    take: number;
    group?: string;
    username?: string;
  }): Promise<[UserListItemDto[], number]> {
    const { skip, take, group, username } = params;

    const normalizedUserUsername = username?.replace('@', '').trim();

    const baseQb = this.repo
      .createQueryBuilder('user')
      .leftJoin('user.participations', 'participation')
      .leftJoin(
        Channel,
        'channel',
        'channel.telegramId = participation."groupId"::bigint',
      )
      .where('user.role = :role', { role: UserRole.USER });

    if (group) {
      baseQb.andWhere(
        'LOWER(channel.telegramUsername) LIKE LOWER(:telegramUsername)',
        {
          telegramUsername: `%${group.replace('@', '')}%`,
        },
      );
    }

    if (normalizedUserUsername) {
      baseQb.andWhere('LOWER("user"."username") LIKE LOWER(:userUsername)', {
        userUsername: `%${normalizedUserUsername}%`,
      });
    }

    try {
      const totalResult = await baseQb
        .clone()
        .select('COUNT(DISTINCT "user"."id")', 'total')
        .getRawOne<{ total: string }>();

      const total = Number(totalResult?.total ?? 0);

      const rows = await baseQb
        .clone()
        .select('"user"."id"', 'id')
        .addSelect('"user"."telegramId"', 'telegramId')
        .addSelect('"user"."username"', 'username')
        .addSelect('COUNT("participation"."id")', 'totalParticipations')
        .groupBy('"user"."id"')
        .addGroupBy('"user"."telegramId"')
        .addGroupBy('"user"."username"')
        .orderBy('"user"."id"', 'DESC')
        .offset(skip)
        .limit(take)
        .getRawMany();

      const items: UserListItemDto[] = rows.map((row) => ({
        id: Number(row.id),
        telegramId: row.telegramId ?? null,
        username: row.username ?? null,
        totalParticipations: Number(row.totalParticipations),
      }));

      return [items, total];
    } catch (error) {
      this.logger.error(
        {
          err: error,
          params,
        },
        'Error fetching users with participation count',
      );

      throw new Error('Error occurred while fetching user list');
    }
  }

  async findUserDetailsById(id: number): Promise<UserDetailsDto | null> {
    const user = await this.repo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.participations', 'participation')
      .leftJoinAndSelect('participation.contest', 'contest')
      .where('user.id = :id', { id })
      .andWhere('user.role = :role', { role: UserRole.USER })
      .getOne();

    if (!user) {
      return null;
    }

    const uniqueGroups = Array.from(
      new Set(
        (user.participations ?? [])
          .map((participation) => participation.groupId)
          .filter(
            (groupId): groupId is string =>
              groupId !== null && groupId !== undefined,
          )
          .map((groupId) => String(groupId)),
      ),
    );

    const uniqueContestsMap = new Map<number, { id: number; name: string }>();

    for (const participation of user.participations ?? []) {
      if (participation.contest) {
        uniqueContestsMap.set(participation.contest.id, {
          id: participation.contest.id,
          name: participation.contest.name,
        });
      }
    }

    return {
      groups: uniqueGroups,
      contests: Array.from(uniqueContestsMap.values()),
    };
  }
}
