import { ContestWinnerStatus } from 'src/common/enums/contest';
import { ContestWinner } from '../entities';

/**
 * Строка победителя на запись. status/confirmationDeadline опциональны:
 * не переданы → БД проставит DEFAULT 'confirmed' и NULL, то есть поведение
 * конкурса без подтверждения приза.
 */
export type ContestWinnerRow = {
  contestId: number;
  userId: number;
  place: number;
  status?: ContestWinnerStatus;
  confirmationDeadline?: Date | null;
};

/**
 * Единый контракт репозитория агрегата ContestWinner (Фаза 9 — слиты read+write).
 * Сервисы зависят от этой абстракции через токен CONTEST_WINNER_REPOSITORY.
 * NB: аудит назначения (ContestWinnerAuditWriteRepository) — отдельный write-only
 * агрегат, в этот контракт НЕ входит.
 */
export interface IContestWinnerRepository {
  // чтение
  findByContestId(contestId: number): Promise<ContestWinner[]>;
  findById(id: number): Promise<ContestWinner | null>;

  // запись
  replace(contestId: number, winners: ContestWinnerRow[]): Promise<void>;
  deleteByContestId(contestId: number): Promise<void>;

  /**
   * Атомарно переводит победителя из PENDING_CONFIRMATION в конечный статус.
   * true — перевод сделал ИМЕННО этот вызов; false — статус уже был не
   * PENDING (двойной клик по кнопке, гонка с джобом дедлайна).
   */
  resolveConfirmation(
    id: number,
    status: ContestWinnerStatus,
    confirmedAt: Date | null,
  ): Promise<boolean>;
}
