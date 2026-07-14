import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContestWinner } from '../entities';
import { IContestWinnerRepository } from '../interfaces';

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

  // ── запись ──────────────────────────────────────────────────────────────

  async replace(
    contestId: number,
    winners: Array<{
      contestId: number;
      userId: number;
      place: number;
    }>,
  ): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      await manager.delete(ContestWinner, { contestId });

      if (!winners.length) {
        return;
      }

      await manager.insert(ContestWinner, winners);
    });
  }

  async deleteByContestId(contestId: number): Promise<void> {
    await this.repo.delete({ contestId });
  }
}
