import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('mailing_messages')
export class MailingMessageEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  mailingJobId: string;

  @Column({ type: 'int', nullable: true })
  userId: number | null;

  @Column({ type: 'bigint' })
  telegramId: string;

  @Column({ type: 'bigint' })
  chatId: string;

  @Column({ type: 'int' })
  messageId: number;

  @Column({ type: 'timestamp' })
  sentAt: Date;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  sendStatus: 'pending' | 'sent' | 'failed';

  @Column({ type: 'text', nullable: true })
  sendError: string | null;

  @Column({ type: 'timestamp' })
  deleteAfter: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  @Column({ default: 'pending' })
  deleteStatus: 'pending' | 'deleted' | 'failed';

  @Column({ type: 'text', nullable: true })
  deleteError: string | null;

  @Column({ type: 'text', nullable: true })
  text: string | null;

  @Column({ type: 'text', nullable: true })
  imagePath: string | null;
}
