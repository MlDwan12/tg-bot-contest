import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IContestParticipationWriteRepository } from '../interfaces';
import { ContestParticipation, ContestPublication } from '../entities';

@Injectable()
export class ContestParticipationWriteRepository implements IContestParticipationWriteRepository {
  constructor(
    @InjectRepository(ContestParticipation)
    private readonly repo: Repository<ContestParticipation>,
  ) {}

  async createParticipation(data: {
    contestId: number;
    userId: number;
    groupId: string;
  }): Promise<ContestParticipation> {
    const participation = this.repo.create(data);
    return await this.repo.save(participation);
  }

  async resetWinnerFlags(contestId: number): Promise<void> {
    await this.repo.update(
      { contestId },
      { isWinner: false, prizePlace: null },
    );
  }

  async markAsWinner(
    contestId: number,
    userId: number,
    place: number,
  ): Promise<void> {
    await this.repo.update(
      { contestId, userId },
      { isWinner: true, prizePlace: place },
    );
  }
}
