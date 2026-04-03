import { PublicationStatus } from 'src/shared/enums/contest';
import {
  Entity,
  Unique,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Contest } from './contest.entity';
import { Channel } from 'src/modules/channels/entities';

@Entity('contest_publications')
@Unique(['contestId', 'channelId'])
export class ContestPublication {
  @PrimaryGeneratedColumn()
  id: number;

  /** конкурс */
  @Column()
  contestId: number;

  @ManyToOne(() => Contest, { onDelete: 'CASCADE' })
  contest: Contest;

  /** логическая сущность канала */
  @Column()
  channelId: number;

  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  channel: Channel;

  /** Telegram chat_id */
  @Column({ type: 'bigint' })
  chatId: number;

  /** Telegram message_id */
  @Column({ type: 'int', nullable: true })
  telegramMessageId?: number;

  /** статус */
  @Column({
    type: 'enum',
    enum: PublicationStatus,
    default: PublicationStatus.PENDING,
  })
  status: PublicationStatus;

  /** текст ошибки */
  @Column({ type: 'text', nullable: true })
  error?: string;

  /** что именно отправили */
  @Column({ type: 'jsonb', nullable: true })
  payload?: {
    text: string;
    photoUrl?: string;
    buttonText?: string;
    buttonUrl: string;
  };

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  publishedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  processingStartedAt?: Date;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
