import { FindOptionsWhere } from 'typeorm';
import { User } from '../entities/user.entity';
import { UserDetailsDto } from '../dto/get-user-details.dto';
import { UserListItemDto } from '../dto/user-list-item.dto';

/**
 * Единый контракт репозитория агрегата User (Фаза 9 — слиты read+write).
 * Сервисы зависят от этой абстракции через токен USER_REPOSITORY.
 */
export interface IUserRepository {
  // чтение
  findById(id: number): Promise<User | null>;
  findOne(filters: FindOptionsWhere<User>): Promise<User | null>;
  findByLogin(login: string): Promise<User | null>;
  findByTelegramId(telegramId: string): Promise<User | null>;
  findAll(): Promise<User[]>;
  findAllByParams(params: FindOptionsWhere<User>): Promise<User[]>;
  findAllUsersWithParticipationCount(params: {
    skip: number;
    take: number;
    group?: string;
    username?: string;
  }): Promise<[UserListItemDto[], number]>;
  findUserDetailsById(id: number): Promise<UserDetailsDto | null>;

  // запись
  create(user: Partial<User>): Promise<User>;
  save(user: User): Promise<User>;
  remove(user: User): Promise<void>;
  update(id: number, data: Partial<User>): Promise<User>;
}
