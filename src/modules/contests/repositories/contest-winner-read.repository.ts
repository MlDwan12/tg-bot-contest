import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ContestWinnerReadRepository as ContestWinnerReadRepositoryContract } from '../interfaces/contest-winner-read-repository.interface';
import { ContestWinner } from '../entities';
import { Repository } from 'typeorm';

@Injectable()
export class ContestWinnerReadRepository implements ContestWinnerReadRepositoryContract {
  constructor(
    @InjectRepository(ContestWinner)
    private readonly repo: Repository<ContestWinner>,
  ) {}

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
}
