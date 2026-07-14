import { ContestWinner } from '../entities';

/**
 * Единый контракт репозитория агрегата ContestWinner (Фаза 9 — слиты read+write).
 * Сервисы зависят от этой абстракции через токен CONTEST_WINNER_REPOSITORY.
 * NB: аудит назначения (ContestWinnerAuditWriteRepository) — отдельный write-only
 * агрегат, в этот контракт НЕ входит.
 */
export interface IContestWinnerRepository {
  // чтение
  findByContestId(contestId: number): Promise<ContestWinner[]>;

  // запись
  replace(
    contestId: number,
    winners: Array<{ contestId: number; userId: number; place: number }>,
  ): Promise<void>;
  deleteByContestId(contestId: number): Promise<void>;
}
