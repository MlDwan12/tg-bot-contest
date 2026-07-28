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
import { ParticipationSubscriptionStatus } from 'src/common/enums/contest';

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

  /**
   * Итог перепроверки подписки на обязательные каналы при завершении конкурса.
   * По умолчанию VALID: подписку проверяли при участии, и до перепроверки
   * считать участника выбывшим нельзя. В розыгрыш идут только VALID.
   */
  @Column({
    type: 'enum',
    enum: ParticipationSubscriptionStatus,
    default: ParticipationSubscriptionStatus.VALID,
  })
  subscriptionStatus: ParticipationSubscriptionStatus;

  /** Когда перепроверяли подписку; null — перепроверка не проводилась. */
  @Column({ type: 'timestamp', nullable: true })
  subscriptionCheckedAt: Date | null;
}
