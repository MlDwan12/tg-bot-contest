import {
  Entity,
  Unique,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
} from 'typeorm';
import { Contest } from './contest.entity';
import { User } from 'src/modules/users/entities';

@Entity('contest_winners')
@Unique(['contestId', 'userId'])
export class ContestWinner {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  contestId: number;

  @Column()
  userId: number;

  @Column()
  place: number;

  @ManyToOne(() => Contest, (c) => c.winners, { onDelete: 'CASCADE' })
  contest: Contest;

  @ManyToOne(() => User)
  user: User;
}
