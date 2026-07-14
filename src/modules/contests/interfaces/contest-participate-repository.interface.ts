import { FindOptionsWhere } from 'typeorm';
import { ContestParticipation } from '../entities';

/**
 * Единый контракт репозитория агрегата ContestParticipation (Фаза 9 — слиты
 * read+write). Сервисы зависят от этой абстракции через токен
 * CONTEST_PARTICIPATE_REPOSITORY. Составлен по ФАКТИЧЕСКОЙ реализации
 * (старый write-интерфейс не включал resetWinnerFlags/markAsWinner).
 */
export interface IContestParticipationRepository {
  // ── чтение ──────────────────────────────────────────────────────────────
  findOneByParam(
    param: FindOptionsWhere<ContestParticipation>,
  ): Promise<ContestParticipation | null>;
  findAllByContestId(contestId: number): Promise<ContestParticipation[]>;
  countParticipants(contestId: number): Promise<number>;
  findManyByContestId(contestId: number): Promise<ContestParticipation[]>;
  countUniqueUsersByContestId(contestId: number): Promise<number>;

  // ── запись ──────────────────────────────────────────────────────────────
  createParticipation(data: {
    contestId: number;
    userId: number;
    groupId: string;
  }): Promise<ContestParticipation>;
  resetWinnerFlags(contestId: number): Promise<void>;
  markAsWinner(
    contestId: number,
    userId: number,
    place: number,
  ): Promise<void>;
  syncWinnerFlagsInTransaction(
    contestId: number,
    winners: Array<{ userId: number; place: number }>,
  ): Promise<void>;
}
