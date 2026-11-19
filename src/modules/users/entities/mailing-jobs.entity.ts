import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type MailingJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'completed_with_errors'
  | 'failed';

@Entity('mailing_jobs')
export class MailingJobEntity {
  @PrimaryColumn()
  id: string;

  @Column({ type: 'varchar', length: 50 })
  type: string;

  @Column({ type: 'bigint', nullable: true })
  initiatorUserId: string | null;

  @Column({ type: 'int', nullable: true })
  contestId: number | null;

  @Column({ type: 'bigint', nullable: true })
  groupId: string | null;

  @Column({ type: 'int', default: 0 })
  totalRecipients: number;

  @Column({ type: 'int', default: 0 })
  queuedCount: number;

  @Column({ type: 'int', default: 0 })
  sentCount: number;

  @Column({ type: 'int', default: 0 })
  failedCount: number;

  // Разбивка failedCount: blockedCount + errorCount = failedCount.
  // blocked — бот заблокирован или аккаунт удалён, errors — всё остальное.
  @Column({ type: 'int', default: 0 })
  blockedCount: number;

  @Column({ type: 'int', default: 0 })
  errorCount: number;

  @Column({ type: 'int', default: 0 })
  skippedCount: number;

  @Column({ type: 'int', default: 0 })
  deletedCount: number;

  @Column({ type: 'int', default: 0 })
  deleteFailedCount: number;

  @Column({
    type: 'varchar',
    length: 50,
    default: 'pending',
  })
  status: MailingJobStatus;

  @Column({ type: 'text', nullable: true })
  text: string | null;

  @Column({ type: 'text', nullable: true })
  imagePath: string | null;

  @Column({ type: 'text', nullable: true })
  buttonText: string | null;

  @Column({ type: 'text', nullable: true })
  buttonUrl: string | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  // Когда статистику отправили во внешний API; null — ещё не отправлена.
  @Column({ type: 'timestamp', nullable: true })
  statsReportedAt: Date | null;

  // Общий виджет прогресса у админов (Bot API 10.4); null — шли текстом.
  @Column({ type: 'varchar', nullable: true })
  progressWidgetId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
