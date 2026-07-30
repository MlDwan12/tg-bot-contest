import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContestWinner } from '../entities';
import { ContestWinnerRow, IContestWinnerRepository } from '../interfaces';
import { ContestWinnerStatus } from 'src/common/enums/contest';

/**
 * Единый репозиторий агрегата ContestWinner (Фаза 9 — слиты read+write).
 * Подключается через токен CONTEST_WINNER_REPOSITORY, сервисы зависят
 * от IContestWinnerRepository.
 */
@Injectable()
export class ContestWinnerRepository implements IContestWinnerRepository {
  constructor(
    @InjectRepository(ContestWinner)
    private readonly repo: Repository<ContestWinner>,
  ) {}

  // ── чтение ──────────────────────────────────────────────────────────────

  async findByContestId(contestId: number): Promise<ContestWinner[]> {
    return this.repo.find({
      where: { contestId },
      relations: {
        user: true,
        contest: false,
      },
      order: {
        place: 'ASC',
      },
    });
  }

  async findById(id: number): Promise<ContestWinner | null> {
    return this.repo.findOne({
      where: { id },
      relations: { user: true, contest: true },
    });
  }

  // ── запись ──────────────────────────────────────────────────────────────

  /**
   * Условный UPDATE вместо «прочитали статус → записали»: между чтением и
   * записью победитель мог успеть нажать вторую кнопку, а джоб дедлайна —
   * проставить EXPIRED. Условие по status делает переход одноразовым, и
   * решает тот, кто пришёл первым.
   */
  async resolveConfirmation(
    id: number,
    status: ContestWinnerStatus,
    confirmedAt: Date | null,
  ): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .update(ContestWinner)
      .set({ status, confirmedAt })
      .where('id = :id', { id })
      .andWhere('status = :pending', {
        pending: ContestWinnerStatus.PENDING_CONFIRMATION,
      })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async replace(contestId: number, winners: ContestWinnerRow[]): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      await manager.delete(ContestWinner, { contestId });

      if (!winners.length) {
        return;
      }

      await manager.insert(ContestWinner, winners);
    });
  }

  async append(row: ContestWinnerRow): Promise<ContestWinner> {
    return this.repo.save(this.repo.create(row));
  }

  async deleteByContestId(contestId: number): Promise<void> {
    await this.repo.delete({ contestId });
  }
}
