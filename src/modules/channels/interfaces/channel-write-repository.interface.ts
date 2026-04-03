import { Channel } from '../entities';

export interface IChannelWriteRepository {
  create(data: Partial<Channel>): Promise<Channel>;

  update(id: number, data: Partial<Channel>): Promise<Channel>;

  delete(id: number): Promise<void>;

  setActive(id: number, isActive: boolean): Promise<void>;
}
