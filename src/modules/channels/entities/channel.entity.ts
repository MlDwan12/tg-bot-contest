import { ChannelType } from 'src/common/enums/channel';
import {
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Entity,
} from 'typeorm';

@Entity('channels')
export class Channel {
  @PrimaryGeneratedColumn()
  id: number;

  // Telegram ID (для интеграции с ботом)
  @Column({ type: 'bigint', unique: true, nullable: true })
  telegramId?: number;

  // Telegram username (может быть пустым)
  @Column({ type: 'varchar', unique: true, nullable: true })
  telegramUsername?: string;

  // Человеческое название
  @Column({ type: 'varchar', length: 100, nullable: true })
  name?: string;

  // Ссылка-приглашение для приватных каналов (без telegramUsername).
  // Публичные каналы её не используют — ссылка строится как t.me/{telegramUsername}.
  @Column({ type: 'varchar', nullable: true })
  inviteLink?: string;

  // Есть лт бот в канале
  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'enum', enum: ChannelType, default: ChannelType.OTHER })
  type: ChannelType;

  @CreateDateColumn()
  createdAt: Date;
}
