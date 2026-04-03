import { IChannelReadFilters } from '.';
import { Channel } from '../entities';

export interface IChannelReadRepository {
  findById(id: number): Promise<Channel | null>;

  findByTelegramId(telegramId: number): Promise<Channel | null>;

  findByTelegramUsername(username: string): Promise<Channel | null>;

  findMany(
    filters?: IChannelReadFilters,
    pagination?: { skip: number; take: number },
  ): Promise<[Channel[], number]>;

  findActive(): Promise<Channel[]>;
}
