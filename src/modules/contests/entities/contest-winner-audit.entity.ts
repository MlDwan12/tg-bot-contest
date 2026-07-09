import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Неизменяемый провенанс победителей: одна строка на РЕАЛЬНОЕ определение
 * победителей конкурса. Покрывает обе стратегии:
 *
 *  • RANDOM — provably-fair: seed + algorithm + участники (пул). Любой может
 *    пересчитать winners = shuffle(seed, отсортированный пул) и убедиться.
 *  • MANUAL — подотчётность: кто назначил (assignedByUserId) и когда. Доказывает
 *    легитимность в споре и защищает операторов от обвинений в инсайде.
 *
 * FK на contests намеренно НЕТ — след должен пережить удаление конкурса.
 * Пишем только INSERT, никогда не меняем/не удаляем.
 */
@Entity('contest_winner_audit')
@Index(['contestId'])
export class ContestWinnerAudit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  contestId: number;

  /** 'RANDOM' | 'MANUAL' (значение WinnerStrategy на момент розыгрыша). */
  @Column()
  strategy: string;

  @Column()
  prizePlaces: number;

  /** Победители по порядку мест (place = индекс + 1) — ВЫХОД. Общее для обеих стратегий. */
  @Column({ type: 'jsonb' })
  winnerUserIds: number[];

  // --- RANDOM (provably-fair) ---

  /** Крипто-случайный seed (hex). Из него детерминированно выводится перемешивание. */
  @Column({ type: 'varchar', nullable: true })
  seed: string | null;

  /** Версия алгоритма, напр. 'fisher-yates-hmac-sha256-v1'. */
  @Column({ type: 'varchar', nullable: true })
  algorithm: string | null;

  /** Канонический (отсортированный по userId) пул участников — ВХОД розыгрыша. */
  @Column({ type: 'jsonb', nullable: true })
  participantUserIds: number[] | null;

  // --- MANUAL (подотчётность) ---

  /** Кто назначил победителей (id администратора из JWT). */
  @Column({ type: 'int', nullable: true })
  assignedByUserId: number | null;

  /** Опциональная заметка/обоснование назначения. */
  @Column({ type: 'varchar', nullable: true })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
