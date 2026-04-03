import { User } from 'src/modules/users/entities';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Contest } from './contest.entity';
import {
  BotMessageContentType,
  BotMessageStatus,
  BotMessageType,
} from 'src/shared/enums/bot';

@Entity('bot_messages')
export class BotMessage {
  @PrimaryGeneratedColumn()
  id: number;

  /** Telegram message_id */
  @Column()
  telegramMessageId: number;

  /** Telegram chat_id (нужно для удаления) */
  @Column({ type: 'bigint' })
  chatId: number;

  /** кому отправили */
  @ManyToOne(() => User, { nullable: false })
  user: User;

  @Column()
  userId: number;

  /** контекст */
  @ManyToOne(() => Contest, { nullable: true })
  contest?: Contest;

  @Column({ nullable: true })
  contestId?: number;

  /** тип бизнес-сообщения */
  @Column({
    type: 'enum',
    enum: BotMessageType,
  })
  type: BotMessageType;

  /** тип контента */
  @Column({
    type: 'enum',
    enum: BotMessageContentType,
  })
  contentType: BotMessageContentType;

  /** статус */
  @Column({
    type: 'enum',
    enum: BotMessageStatus,
    default: BotMessageStatus.SENT,
  })
  status: BotMessageStatus;

  /** данные сообщения */
  @Column({ type: 'jsonb', nullable: true })
  payload?: {
    text?: string;
    photoUrl?: string;
    buttonText?: string;
    buttonUrl?: string;
  };

  @CreateDateColumn()
  createdAt: Date;
}
