import { FindOptionsWhere } from 'typeorm';
import { Channel } from '../entities';
import { IChannelReadFilters } from '.';

/**
 * Единый контракт репозитория агрегата Channel (Фаза 9 — слиты read+write).
 * Сервисы зависят от этой абстракции через токен CHANNEL_REPOSITORY.
 */
export interface IChannelRepository {
  // чтение
  findById(id: number): Promise<Channel | null>;
  findByTelegramId(telegramId: number): Promise<Channel | null>;
  findByTelegramUsername(username: string): Promise<Channel | null>;
  findManyByIds(ids: number[]): Promise<Channel[]>;
  findMany(
    filters?: IChannelReadFilters,
    pagination?: { skip: number; take: number },
  ): Promise<[Channel[], number]>;
  findManyByParams(params: FindOptionsWhere<Channel>): Promise<Channel[]>;
  findActive(): Promise<Channel[]>;

  // запись
  create(data: Partial<Channel>): Promise<Channel>;
  update(id: number, data: Partial<Channel>): Promise<Channel>;
  delete(id: number): Promise<void>;
  deleteByTelegramId(telegramId: number): Promise<void>;
  setActive(id: number, isActive: boolean): Promise<void>;
}
