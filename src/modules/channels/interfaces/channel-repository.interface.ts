import { FindOptionsWhere } from 'typeorm';
import { ChannelPlatform } from 'src/common/enums/channel';
import { Channel } from '../entities';
import { IChannelReadFilters } from '.';

/**
 * Единый контракт репозитория агрегата Channel (Фаза 9 — слиты read+write).
 * Сервисы зависят от этой абстракции через токен CHANNEL_REPOSITORY.
 */
export interface IChannelRepository {
  // чтение
  findById(id: number): Promise<Channel | null>;
  findByExternalId(
    platform: ChannelPlatform,
    externalId: string,
  ): Promise<Channel | null>;
  findByExternalUsername(
    platform: ChannelPlatform,
    externalUsername: string,
  ): Promise<Channel | null>;
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
  deleteByExternalId(
    platform: ChannelPlatform,
    externalId: string,
  ): Promise<void>;
  setActive(id: number, isActive: boolean): Promise<void>;
}
