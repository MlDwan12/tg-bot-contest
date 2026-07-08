import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { IContestParticipationWriteRepository } from '../interfaces';
import { ContestParticipation } from '../entities';

@Injectable()
export class ContestParticipationWriteRepository implements IContestParticipationWriteRepository {
  constructor(
    @InjectRepository(ContestParticipation)
    private readonly repo: Repository<ContestParticipation>,
    private readonly dataSource: DataSource,
  ) {}

  async createParticipation(data: {
    contestId: number;
    userId: number;
    groupId: string;
  }): Promise<ContestParticipation> {
    const participation = this.repo.create(data);
    return await this.repo.save(participation);
  }

  async resetWinnerFlags(contestId: number): Promise<void> {
    await this.repo.update(
      { contestId },
      { isWinner: false, prizePlace: null },
    );
  }

  async markAsWinner(
    contestId: number,
    userId: number,
    place: number,
  ): Promise<void> {
    await this.repo.update(
      { contestId, userId },
      { isWinner: true, prizePlace: place },
    );
  }

  /**
   * Атомарно сбрасывает все флаги победителей и выставляет новые в одной
   * транзакции. Читатели никогда не увидят состояние "все сброшены, никто
   * не выставлен" — только старый набор победителей или новый.
   */
  async syncWinnerFlagsInTransaction(
    contestId: number,
    winners: Array<{ userId: number; place: number }>,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // 1. Сбросить все флаги одним UPDATE по contestId
      await manager
        .createQueryBuilder()
        .update(ContestParticipation)
        .set({ isWinner: false, prizePlace: null })
        .where('"contestId" = :contestId', { contestId })
        .execute();

      // 2. Выставить флаги только для победителей
      for (const { userId, place } of winners) {
        await manager
          .createQueryBuilder()
          .update(ContestParticipation)
          .set({ isWinner: true, prizePlace: place })
          .where('"contestId" = :contestId AND "userId" = :userId', {
            contestId,
            userId,
          })
          .execute();
      }
    });
  }
}
