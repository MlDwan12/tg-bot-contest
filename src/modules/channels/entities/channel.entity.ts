import { ChannelPlatform, ChannelType } from 'src/common/enums/channel';
import {
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Entity,
  Unique,
} from 'typeorm';

@Entity('channels')
@Unique(['platform', 'externalId'])
export class Channel {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'enum',
    enum: ChannelPlatform,
    default: ChannelPlatform.TELEGRAM,
  })
  platform: ChannelPlatform;

  // id канала на стороне платформы (у Telegram — chat id вида "-100...")
  @Column({ type: 'varchar', nullable: true })
  externalId?: string;

  // username канала на платформе (может быть пустым)
  @Column({ type: 'varchar', nullable: true })
  externalUsername?: string;

  // Человеческое название
  @Column({ type: 'varchar', length: 100, nullable: true })
  name?: string;

  // Есть лт бот в канале
  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'enum', enum: ChannelType, default: ChannelType.OTHER })
  type: ChannelType;

  @CreateDateColumn()
  createdAt: Date;
}
