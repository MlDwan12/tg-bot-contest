import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { ContestParticipation } from '../entities';
import { IContestParticipationRepository } from '../interfaces';

/**
 * Единый репозиторий агрегата ContestParticipation (Фаза 9 — слиты read+write).
 * Подключается через токен CONTEST_PARTICIPATE_REPOSITORY, сервисы зависят
 * от IContestParticipationRepository.
 */
@Injectable()
export class ContestParticipationRepository
  implements IContestParticipationRepository
{
  constructor(
    @InjectRepository(ContestParticipation)
    private readonly repo: Repository<ContestParticipation>,
    private readonly dataSource: DataSource,
  ) {}

  // ── чтение ──────────────────────────────────────────────────────────────

  async findOneByParam(
    param: FindOptionsWhere<ContestParticipation>,
  ): Promise<ContestParticipation | null> {
    return await this.repo.findOne({
      where: param,
    });
  }

  async findAllByContestId(contestId: number): Promise<ContestParticipation[]> {
    return await this.repo.find({
      where: { contestId },
      relations: ['user'],
    });
  }

  async countParticipants(contestId: number): Promise<number> {
    return await this.repo.count({
      where: { contestId },
    });
  }

  async findManyByContestId(
    contestId: number,
  ): Promise<ContestParticipation[]> {
    return this.repo.find({
      where: { contestId },
      relations: {
        user: true,
      },
    });
  }

  async countUniqueUsersByContestId(contestId: number): Promise<number> {
    const result = await this.repo
      .createQueryBuilder('participation')
      .select('COUNT(DISTINCT participation.userId)', 'count')
      .where('participation.contestId = :contestId', { contestId })
      .getRawOne<{ count: string }>();

    return Number(result?.count ?? 0);
  }

  // ── запись ──────────────────────────────────────────────────────────────

  async createParticipation(data: {
    contestId: number;
    userId: number;
    groupId: string;
  }): Promise<ContestParticipation> {
    const participation = this.repo.create(data);
    return await this.repo.save(participation);
  }

  async resetWinnerFlags(contestId: number): Promise<void> {
    await this.repo.update({ contestId }, { isWinner: false, prizePlace: null });
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
