import {
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Entity,
  JoinTable,
  ManyToMany,
} from 'typeorm';
import { ContestParticipation } from './contest-participation.entity';
import { User } from 'src/modules/users/entities';
import { ContestStatus, WinnerStrategy } from 'src/shared/enums/contest';
import { ContestWinner } from '.';
import { Channel } from 'src/modules/channels/entities';
import { ContestPublication } from './contest-publications.entity';

@Entity('contests')
export class Contest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  imagePath?: string;

  @Column({ nullable: true })
  buttonText?: string;

  @Column({ type: 'enum', enum: ContestStatus })
  status: ContestStatus;

  @Column({ type: 'enum', enum: WinnerStrategy })
  winnerStrategy: WinnerStrategy;

  @Column()
  prizePlaces: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'creatorId' })
  creator: User;

  @Column()
  creatorId: number;

  @Column({ type: 'timestamp' })
  startDate: Date;

  @Column({ type: 'timestamp' })
  endDate: Date;

  @ManyToMany(() => Channel)
  @JoinTable({
    name: 'contest_publish_channels',
  })
  publishChannels: Channel[];

  @ManyToMany(() => Channel)
  @JoinTable({
    name: 'contest_required_channels',
  })
  requiredChannels: Channel[];

  @OneToMany(() => ContestPublication, (p) => p.contest)
  publications: ContestPublication[];

  @OneToMany(() => ContestParticipation, (p) => p.contest)
  participants: ContestParticipation[];

  @OneToMany(() => ContestWinner, (w) => w.contest)
  winners: ContestWinner[];

  @CreateDateColumn()
  createdAt: Date;
}
