import { Injectable, NotFoundException } from '@nestjs/common';
import { UserReadRepository, UserWriteRepository } from '../repositories';
import { User } from '../entities';
import { FindOptionsWhere } from 'typeorm';
import { UserListItemDto } from '../dto/user-list-item.dto';
import { UserDetailsDto } from '../dto/get-user-details.dto';
import { Paginated } from 'src/shared/commons/response/paginated.type';
import { buildPaginatedResponse } from 'src/common/helpers/paginatedResponse.helper';
import { getPaginationParams } from 'src/common/helpers/paginationParams.helper';

@Injectable()
export class UsersService {
  constructor(
    private readonly readRepo: UserReadRepository,
    private readonly writeRepo: UserWriteRepository,
  ) {}

  findById(id: number): Promise<User | null> {
    return this.readRepo.findById(id);
  }

  findByLogin(login: string): Promise<User | null> {
    return this.readRepo.findByLogin(login);
  }

  findByTelegramId(telegramId: string): Promise<User | null> {
    return this.readRepo.findByTelegramId(telegramId);
  }

  findOne(filters: FindOptionsWhere<User>): Promise<User | null> {
    return this.readRepo.findOne(filters);
  }
  findAllByParams(params: FindOptionsWhere<User>): Promise<User[]> {
    return this.readRepo.findAllByParams(params);
  }

  findAll(): Promise<User[]> {
    return this.readRepo.findAll();
  }

  create(user: Partial<User>): Promise<User> {
    return this.writeRepo.create(user);
  }

  save(user: User): Promise<User> {
    return this.writeRepo.save(user);
  }

  remove(user: User): Promise<void> {
    return this.writeRepo.remove(user);
  }

  async findAllUsersWithParticipationCount(query: {
    page?: number;
    limit?: number;
    group?: string;
    search?: string;
  }): Promise<Paginated<UserListItemDto>> {
    const { page, limit, skip, take } = getPaginationParams(
      query.page,
      query.limit,
    );

    const [items, total] =
      await this.readRepo.findAllUsersWithParticipationCount({
        skip,
        take,
        group: query.group,
        username: query.search,
      });

    return buildPaginatedResponse({
      items,
      total,
      page,
      limit,
    });
  }

  async findUserDetailsById(id: number): Promise<UserDetailsDto> {
    const userDetails = await this.readRepo.findUserDetailsById(id);

    if (!userDetails) {
      throw new NotFoundException(`User with id=${id} not found`);
    }

    return userDetails;
  }
}
