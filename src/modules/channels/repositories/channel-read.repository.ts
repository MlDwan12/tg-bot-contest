import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository, SelectQueryBuilder } from 'typeorm';
import { Channel } from '../entities/channel.entity';
import { IChannelReadFilters, IChannelReadRepository } from '../interfaces';

@Injectable()
export class ChannelReadRepository implements IChannelReadRepository {
  constructor(
    @InjectRepository(Channel)
    private readonly repo: Repository<Channel>,
  ) {}

  findById(id: number): Promise<Channel | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByTelegramId(telegramId: number): Promise<Channel | null> {
    return this.repo.findOne({
      where: { telegramId },
    });
  }

  findByTelegramUsername(telegramUsername: string): Promise<Channel | null> {
    return this.repo.findOne({
      where: { telegramUsername },
    });
  }

  async findManyByIds(ids: number[]): Promise<Channel[]> {
    if (!ids?.length) return [];

    return this.repo.find({
      where: {
        id: In(ids),
      },
    });
  }

  async findMany(
    filters?: IChannelReadFilters,
    pagination?: { skip: number; take: number },
  ): Promise<[Channel[], number]> {
    const qb = this.repo.createQueryBuilder('channel');

    this.applyFilters(qb, filters);

    qb.orderBy('channel.createdAt', 'DESC');

    if (pagination) {
      qb.skip(pagination.skip);
      qb.take(pagination.take);
    }

    return qb.getManyAndCount();
  }

  async findManyByParams(
    params: FindOptionsWhere<Channel>,
  ): Promise<Channel[]> {
    return this.repo.find({
      where: params,
    });
  }

  findActive(): Promise<Channel[]> {
    return this.repo.find({
      where: { isActive: true },
    });
  }

  private applyFilters(
    qb: SelectQueryBuilder<Channel>,
    filters?: IChannelReadFilters,
  ) {
    if (!filters) return;

    if (filters.type) {
      qb.andWhere('channel.type = :type', {
        type: filters.type,
      });
    }

    if (filters.isActive !== undefined) {
      qb.andWhere('channel.isActive = :isActive', {
        isActive: filters.isActive,
      });
    }
  }
}
