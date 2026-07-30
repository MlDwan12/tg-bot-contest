import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  FindOptionsWhere,
  In,
  MoreThan,
  Repository,
} from 'typeorm';
import { ContestParticipation } from '../entities';
import { IContestParticipationRepository } from '../interfaces';
import { ParticipationSubscriptionStatus } from 'src/common/enums/contest';

/**
 * Единый репозиторий агрегата ContestParticipation (Фаза 9 — слиты read+write).
 * Подключается через токен CONTEST_PARTICIPATE_REPOSITORY, сервисы зависят
 * от IContestParticipationRepository.
 */
@Injectable()
export class ContestParticipationRepository implements IContestParticipationRepository {
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

  /**
   * Пул розыгрыша: только участники, прошедшие перепроверку подписки.
   * Пока перепроверка не проводилась, все участия VALID — выборка совпадает
   * с findManyByContestId, поведение конкурсов без перепроверки не меняется.
   */
  async findEligibleByContestId(
    contestId: number,
  ): Promise<ContestParticipation[]> {
    return this.repo.find({
      where: {
        contestId,
        subscriptionStatus: ParticipationSubscriptionStatus.VALID,
      },
      relations: {
        user: true,
      },
    });
  }

  /**
   * Порция участий для выгрузки, keyset-пагинация по id.
   *
   * OFFSET здесь не годится: на десятках тысяч строк он заставляет базу
   * пролистывать всё от начала на каждой странице. Курсор по id читает ровно
   * нужный кусок по индексу первичного ключа.
   */
  async findPageForExport(
    contestId: number,
    afterId: number,
    limit: number,
  ): Promise<ContestParticipation[]> {
    return this.repo.find({
      where: { contestId, id: MoreThan(afterId) },
      relations: { user: true },
      order: { id: 'ASC' },
      take: limit,
    });
  }

  /**
   * Разрез участий по итогу перепроверки подписки — метрика качества
   * аудитории. Считаем уникальных пользователей, а не строки участия: один
   * человек не должен весить больше другого.
   */
  async countBySubscriptionStatus(
    contestId: number,
  ): Promise<Record<ParticipationSubscriptionStatus, number>> {
    const rows = await this.repo
      .createQueryBuilder('participation')
      .select('participation.subscriptionStatus', 'status')
      .addSelect('COUNT(DISTINCT participation.userId)', 'count')
      .where('participation.contestId = :contestId', { contestId })
      .groupBy('participation.subscriptionStatus')
      .getRawMany<{ status: ParticipationSubscriptionStatus; count: string }>();

    const result = {
      [ParticipationSubscriptionStatus.VALID]: 0,
      [ParticipationSubscriptionStatus.UNSUBSCRIBED]: 0,
    };

    for (const row of rows) {
      result[row.status] = Number(row.count);
    }

    return result;
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

  /**
   * Проставляет итог перепроверки пачкой: один UPDATE на статус, а не запрос
   * на участника. При десятках тысяч участий разница принципиальная.
   */
  async markSubscriptionStatuses(
    updates: Array<{
      participationIds: number[];
      status: ParticipationSubscriptionStatus;
    }>,
    checkedAt: Date,
  ): Promise<void> {
    for (const update of updates) {
      if (!update.participationIds.length) continue;

      await this.repo.update(
        { id: In(update.participationIds) },
        {
          subscriptionStatus: update.status,
          subscriptionCheckedAt: checkedAt,
        },
      );
    }
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
