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

  // Реальный победитель ссылается на users; у фиктивного (ник без TG-аккаунта)
  // userId = null, а имя хранится в displayUsername. Тип колонки задан явно:
  // при union-типе (number | null) TypeORM не выводит его из метаданных.
  @Column({ type: 'int', nullable: true })
  userId: number | null;

  // Ник, вписанный оператором вручную (@ivan_petrov) для фиктивного победителя.
  @Column({ type: 'varchar', nullable: true })
  displayUsername: string | null;

  @Column()
  place: number;

  @ManyToOne(() => Contest, (c) => c.winners, { onDelete: 'CASCADE' })
  contest: Contest;

  @ManyToOne(() => User, { nullable: true })
  user: User | null;
}
