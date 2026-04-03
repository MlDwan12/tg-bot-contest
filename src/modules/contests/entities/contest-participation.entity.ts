import { User } from 'src/modules/users/entities/user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Contest } from './contest.entity';

@Entity('contest_participants')
@Index(['contestId', 'userId'], { unique: true })
@Index(['contestId', 'prizePlace'])
@Index(['userId'])
export class ContestParticipation {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Contest, (contest) => contest.participants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'contestId' })
  contest: Contest;

  @Column()
  contestId: number;

  @ManyToOne(() => User, (user) => user.participations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  @CreateDateColumn()
  joinedAt: Date;

  @Column({ type: 'smallint', nullable: true })
  prizePlace: number | null; // 1, 2, 3... или null → не победитель

  @Column({ default: false })
  isWinner: boolean; // можно дублировать для удобства (или вычислять: place !== null)

  @Column({ type: 'bigint', nullable: true })
  groupId: string;
}
