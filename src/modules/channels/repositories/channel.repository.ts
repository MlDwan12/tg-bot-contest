import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository, SelectQueryBuilder } from 'typeorm';
import { ChannelPlatform } from 'src/common/enums/channel';
import { Channel } from '../entities/channel.entity';
import { IChannelReadFilters, IChannelRepository } from '../interfaces';

/**
 * Единый репозиторий агрегата Channel (Фаза 9 — слиты read+write).
 * Подключается через токен CHANNEL_REPOSITORY, сервисы зависят от IChannelRepository.
 */
@Injectable()
export class ChannelRepository implements IChannelRepository {
  constructor(
    @InjectRepository(Channel)
    private readonly repo: Repository<Channel>,
  ) {}

  // ── чтение ───────────────────────────────────────────────────────────────

  findById(id: number): Promise<Channel | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByExternalId(
    platform: ChannelPlatform,
    externalId: string,
  ): Promise<Channel | null> {
    return this.repo.findOne({
      where: { platform, externalId },
    });
  }

  findByExternalUsername(
    platform: ChannelPlatform,
    externalUsername: string,
  ): Promise<Channel | null> {
    return this.repo.findOne({
      where: { platform, externalUsername },
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

  // ── запись ───────────────────────────────────────────────────────────────

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

  async deleteByExternalId(
    platform: ChannelPlatform,
    externalId: string,
  ): Promise<void> {
    const channel = await this.repo.findOneBy({ platform, externalId });

    if (!channel) {
      throw new NotFoundException(
        `Channel with platform=${platform} externalId=${externalId} not found`,
      );
    }

    await this.repo.delete({ id: channel.id });
  }

  async setActive(id: number, isActive: boolean): Promise<void> {
    await this.ensureExists(id);

    await this.repo.update(id, { isActive });
  }

  // ── приватное ────────────────────────────────────────────────────────────

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

  private async ensureExists(id: number): Promise<void> {
    const exists = await this.repo.exist({
      where: { id },
    });

    if (!exists) {
      throw new NotFoundException(`Channel with id=${id} not found`);
    }
  }
}
