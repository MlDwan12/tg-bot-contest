import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from '../entities';
import { IChannelWriteRepository } from '../interfaces';

@Injectable()
export class ChannelWriteRepository implements IChannelWriteRepository {
  constructor(
    @InjectRepository(Channel)
    private readonly repo: Repository<Channel>,
  ) {}

  async create(data: Partial<Channel>): Promise<Channel> {
    const channel = this.repo.create(data);
    return this.repo.save(channel);
  }

  async update(id: number, data: Partial<Channel>): Promise<Channel> {
    await this.ensureExists(id);

    await this.repo.update(id, data);

    return this.repo.findOneByOrFail({ id });
  }

  async delete(id: number): Promise<void> {
    await this.ensureExists(id);
    await this.repo.delete(id);
  }

  async deleteByTelegramId(telegramId: number): Promise<void> {
    const channel = await this.repo.findOneBy({ telegramId });

    if (!channel) {
      throw new NotFoundException(
        `Channel with telegramId=${telegramId} not found`,
      );
    }

    await this.repo.delete({ id: channel.id });
  }

  async setActive(id: number, isActive: boolean): Promise<void> {
    await this.ensureExists(id);

    await this.repo.update(id, { isActive });
  }

  private async ensureExists(id: number): Promise<void> {
    const exists = await this.repo.exist({
      where: { id },
    });

    if (!exists) {
      throw new NotFoundException(`Channel with id=${id} not found`);
    }
  }
}
