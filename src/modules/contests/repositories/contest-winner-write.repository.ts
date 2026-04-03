import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ContestWinnerWriteRepository as ContestWinnerWriteRepositoryContract } from '../interfaces/contest-winner-write-repository.interface';
import { ContestWinner } from '../entities';
import { Repository } from 'typeorm';

@Injectable()
export class ContestWinnerWriteRepository implements ContestWinnerWriteRepositoryContract {
  constructor(
    @InjectRepository(ContestWinner)
    private readonly repo: Repository<ContestWinner>,
  ) {}

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
