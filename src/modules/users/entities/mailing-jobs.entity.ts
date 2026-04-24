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

  @Column({ type: 'int', nullable: true })
  initiatorUserId: number | null;

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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
