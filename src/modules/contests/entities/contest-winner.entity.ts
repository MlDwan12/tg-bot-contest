import {
  Entity,
  Unique,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
} from 'typeorm';
import { Contest } from './contest.entity';
import { User } from 'src/modules/users/entities';
import { ContestWinnerStatus } from 'src/common/enums/contest';

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

  /**
   * Состояние выдачи приза. DEFAULT 'confirmed' не случаен: при выключенном
   * requireWinnerConfirmation подтверждать нечего, и конкурс должен идти ровно
   * как до Ш10. Он же закрывает уже существующие строки при миграции — иначе
   * автодобор запустился бы задним числом по завершённым конкурсам.
   */
  @Column({
    type: 'enum',
    enum: ContestWinnerStatus,
    default: ContestWinnerStatus.CONFIRMED,
  })
  status: ContestWinnerStatus;

  /**
   * До какого момента ждём подтверждения. null — подтверждение не требуется.
   * Дедлайн у КАЖДОЙ строки свой: победитель, занявший место по замене, получает
   * полный срок с момента назначения, а не остаток чужого.
   */
  @Column({ type: 'timestamp', nullable: true })
  confirmationDeadline: Date | null;

  /** Когда победитель подтвердил приз. null — ещё не подтверждал. */
  @Column({ type: 'timestamp', nullable: true })
  confirmedAt: Date | null;

  @ManyToOne(() => Contest, (c) => c.winners, { onDelete: 'CASCADE' })
  contest: Contest;

  @ManyToOne(() => User, { nullable: true })
  user: User | null;
}
