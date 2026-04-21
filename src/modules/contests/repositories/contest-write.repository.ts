import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Contest } from '../entities/contest.entity';
import { ContestStatus, PublicationStatus } from 'src/shared/enums/contest';
import { Channel } from 'src/modules/channels/entities';
import { IContestWriteRepository } from '../interfaces';
import { ContestPublication, ContestWinner } from '../entities';

@Injectable()
export class ContestWriteRepository implements IContestWriteRepository {
  constructor(
    @InjectRepository(Contest)
    private readonly contestRepo: Repository<Contest>,

    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,

    @InjectRepository(ContestPublication)
    private readonly publicationRepo: Repository<ContestPublication>,

    private readonly dataSource: DataSource,
  ) {}

  async create(data: Partial<Contest>): Promise<Contest> {
    const contest = this.contestRepo.create(data);
    return this.contestRepo.save(contest);
  }

  async update(id: number, data: Partial<Contest>): Promise<Contest> {
    await this.ensureExists(id);

    await this.contestRepo.update(id, data);

    return this.contestRepo.findOneByOrFail({ id });
  }

  async delete(id: number): Promise<void> {
    await this.ensureExists(id);
    await this.contestRepo.delete(id);
  }

  async setStatus(id: number, status: ContestStatus): Promise<void> {
    await this.ensureExists(id);

    await this.contestRepo.update(id, { status });
  }

  /**
   * Идемпотентный апдейт статуса: обновит только если текущий статус совпадает.
   * Возвращает true если реально обновил, false если нет.
   */
  async updateStatusIfCurrent(
    contestId: number,
    current: ContestStatus,
    next: ContestStatus,
  ): Promise<boolean> {
    const res = await this.contestRepo
      .createQueryBuilder()
      .update(Contest)
      .set({ status: next })
      .where('"id" = :id', { id: contestId })
      .andWhere('"status" = :current', { current })
      .execute();

    return (res.affected ?? 0) > 0;
  }

  /**
   * Переводит в COMPLETED, только если ещё не COMPLETED.
   * Возвращает true если обновил.
   */
  async updateStatusIfNotCompleted(contestId: number): Promise<boolean> {
    const res = await this.contestRepo
      .createQueryBuilder()
      .update(Contest)
      .set({ status: ContestStatus.COMPLETED })
      .where('"id" = :id', { id: contestId })
      .andWhere('"status" != :completed', {
        completed: ContestStatus.COMPLETED,
      })
      .execute();

    // если contest не существует — можно вернуть false (или бросать исключение, на твой вкус)
    return (res.affected ?? 0) > 0;
  }

  // async setPublishChannels(
  //   contestId: number,
  //   channelIds: number[],
  // ): Promise<void> {
  //   const contest = await this.contestRepo.findOne({
  //     where: { id: contestId },
  //     relations: { publishChannels: true },
  //   });

  //   if (!contest) throw new NotFoundException('Contest not found');

  //   contest.publishChannels = await this.channelRepo.find({
  //     where: { id: In(channelIds) },
  //   });

  //   await this.contestRepo.save(contest);
  // }

  // async setRequiredChannels(
  //   contestId: number,
  //   channelIds: number[],
  // ): Promise<void> {
  //   const contest = await this.contestRepo.findOne({
  //     where: { id: contestId },
  //     relations: { requiredChannels: true },
  //   });

  //   if (!contest) throw new NotFoundException('Contest not found');

  //   contest.requiredChannels = await this.channelRepo.find({
  //     where: { id: In(channelIds) },
  //   });

  //   await this.contestRepo.save(contest);
  // }

  async setPublishChannels(
    contestId: number,
    channelIds: number[],
  ): Promise<void> {
    const contest = await this.contestRepo.findOne({
      where: { id: contestId },
      relations: { publishChannels: true },
    });

    if (!contest) {
      throw new NotFoundException('Contest not found');
    }

    const uniqueIds = [...new Set(channelIds)];
    const channels = uniqueIds.length
      ? await this.channelRepo.find({
          where: { id: In(uniqueIds) },
        })
      : [];

    if (channels.length !== uniqueIds.length) {
      throw new NotFoundException('One or more publish channels not found');
    }

    contest.publishChannels = channels;
    await this.contestRepo.save(contest);
  }

  async setRequiredChannels(
    contestId: number,
    channelIds: number[],
  ): Promise<void> {
    const contest = await this.contestRepo.findOne({
      where: { id: contestId },
      relations: { requiredChannels: true },
    });

    if (!contest) {
      throw new NotFoundException('Contest not found');
    }

    const uniqueIds = [...new Set(channelIds)];
    const channels = uniqueIds.length
      ? await this.channelRepo.find({
          where: { id: In(uniqueIds) },
        })
      : [];

    if (channels.length !== uniqueIds.length) {
      throw new NotFoundException('One or more required channels not found');
    }

    contest.requiredChannels = channels;
    await this.contestRepo.save(contest);
  }

  async createPublications(data: Partial<ContestPublication>[]): Promise<void> {
    if (!data.length) return;

    await this.publicationRepo.insert(data);
  }

  /**
   * Атомарно "забирает" публикацию в обработку: PENDING -> PROCESSING.
   * Если запись уже забрал другой воркер/не PENDING, вернёт null.
   *
   * Для этого в PublicationStatus нужен PROCESSING.
   */
  async claimPublication(
    publicationId: number,
  ): Promise<ContestPublication | null> {
    const res = await this.publicationRepo
      .createQueryBuilder()
      .update(ContestPublication)
      .set({
        status: PublicationStatus.PROCESSING,
        attempts: () => `"attempts" + 1`,
        processingStartedAt: () => 'NOW()',
      })
      .where('"id" = :id', { id: publicationId })
      .andWhere('"status" = :st', { st: PublicationStatus.PENDING })
      .returning('*')
      .execute();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return res.raw?.[0] ?? null;
  }

  async markPublicationPublished(
    publicationId: number,
    data: { telegramMessageId: number; publishedAt: Date },
  ): Promise<void> {
    await this.publicationRepo.update(publicationId, {
      status: PublicationStatus.PUBLISHED,
      telegramMessageId: data.telegramMessageId,
      publishedAt: data.publishedAt,
      error: undefined,
    });
  }

  async markPublicationFailed(
    publicationId: number,
    data: { error: string },
  ): Promise<void> {
    await this.publicationRepo.update(publicationId, {
      status: PublicationStatus.FAILED,
      error: data.error,
    });
  }

  /**
   * Обновляет error, не меняя статус (обычно processor после этого throw -> retry).
   * Можно оставить статус PROCESSING — job повторно запустится, но claim уже не сработает.
   *
   * Поэтому важно: при throw лучше возвращать публикацию обратно в PENDING
   * или хранить retry через отдельное поле nextRetryAt.
   *
   * Для MVP проще: при временной ошибке переводим обратно в PENDING.
   */
  async bumpPublicationError(
    publicationId: number,
    data: { error: string },
  ): Promise<void> {
    await this.publicationRepo.update(publicationId, {
      status: PublicationStatus.PENDING,
      error: data.error,
      processingStartedAt: undefined,
    });
  }

  async requeueStalePublications(staleMinutes: number): Promise<number> {
    const res = await this.publicationRepo
      .createQueryBuilder()
      .update(ContestPublication)
      .set({
        status: PublicationStatus.PENDING,
        processingStartedAt: undefined,
      })
      .where('"status" = :st', { st: PublicationStatus.PROCESSING })
      .andWhere('"processingStartedAt" IS NOT NULL')
      .andWhere(
        `"processingStartedAt" < NOW() - (:mins * INTERVAL '1 minute')`,
        {
          mins: staleMinutes,
        },
      )
      .execute();

    return res.affected ?? 0;
  }

  async findPendingPublicationIdsForActiveContests(
    limit: number,
  ): Promise<number[]> {
    const rows = await this.publicationRepo
      .createQueryBuilder('p')
      .select('p.id', 'id')
      .innerJoin('p.contest', 'c')
      .where('p.status = :pst', { pst: PublicationStatus.PENDING })
      .andWhere('c.status = :cst', { cst: ContestStatus.ACTIVE })
      .orderBy('p.id', 'ASC')
      .limit(Math.max(1, Math.min(limit, 5000)))
      .getRawMany<{ id: number }>();

    return rows.map((r) => Number(r.id));
  }

  private async ensureExists(id: number): Promise<void> {
    const exists = await this.contestRepo.findOne({ where: { id } });

    if (!exists) {
      throw new NotFoundException(`Contest with id=${id} not found`);
    }
  }

  async replaceWinners(
    contestId: number,
    winners: Array<{
      contestId: number;
      userId: number;
      place: number;
    }>,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // удалить старых победителей
      await manager.delete(ContestWinner, { contestId });

      // если передали новых — вставить
      if (winners.length) {
        await manager.insert(ContestWinner, winners);
      }
    });
  }

  async cancelPendingPublications(contestId: number): Promise<void> {
    await this.publicationRepo
      .createQueryBuilder()
      .update(ContestPublication)
      .set({ status: PublicationStatus.CANCELLED })
      .where('"contestId" = :contestId', { contestId })
      .andWhere('status IN (:...statuses)', {
        statuses: [
          PublicationStatus.PENDING,
          PublicationStatus.FAILED,
          PublicationStatus.PUBLISHED,
        ],
      })
      .execute();
  }

  async deletePendingPublicationsByContestId(contestId: number): Promise<void> {
    await this.publicationRepo.delete({
      contestId,
      status: PublicationStatus.PENDING,
    });
  }

  async findPublishedPublicationsByContestId(
    contestId: number,
  ): Promise<ContestPublication[]> {
    return await this.publicationRepo.find({
      where: {
        contestId,
        status: PublicationStatus.PUBLISHED,
      },
      relations: {
        channel: true,
      },
    });
  }

  async updatePublication(
    publicationId: number,
    data: Partial<ContestPublication>,
  ): Promise<void> {
    await this.publicationRepo.update(publicationId, data);
  }
}
