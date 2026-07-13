import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { IUserRepository } from '../interfaces';
import { USER_REPOSITORY } from 'src/common/constants';
import { User } from '../entities';
import { FindOptionsWhere } from 'typeorm';
import { UserListItemDto } from '../dto/user-list-item.dto';
import { UserDetailsDto } from '../dto/get-user-details.dto';
import { Paginated } from 'src/common/response/paginated.type';
import { buildPaginatedResponse } from 'src/common/helpers/paginatedResponse.helper';
import { getPaginationParams } from 'src/common/helpers/paginationParams.helper';

@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
  ) {}

  findById(id: number): Promise<User | null> {
    return this.userRepo.findById(id);
  }

  findByLogin(login: string): Promise<User | null> {
    return this.userRepo.findByLogin(login);
  }

  findByTelegramId(telegramId: string): Promise<User | null> {
    return this.userRepo.findByTelegramId(telegramId);
  }

  findOne(filters: FindOptionsWhere<User>): Promise<User | null> {
    return this.userRepo.findOne(filters);
  }
  findAllByParams(params: FindOptionsWhere<User>): Promise<User[]> {
    return this.userRepo.findAllByParams(params);
  }

  findAll(): Promise<User[]> {
    return this.userRepo.findAll();
  }

  create(user: Partial<User>): Promise<User> {
    return this.userRepo.create(user);
  }

  save(user: User): Promise<User> {
    return this.userRepo.save(user);
  }

  remove(user: User): Promise<void> {
    return this.userRepo.remove(user);
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
      await this.userRepo.findAllUsersWithParticipationCount({
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
    const userDetails = await this.userRepo.findUserDetailsById(id);

    if (!userDetails) {
      throw new NotFoundException(`User with id=${id} not found`);
    }

    return userDetails;
  }
}
