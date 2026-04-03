import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { ContestParticipationReadRepository as ContestParticipationReadRepositoryContract } from '../interfaces/contest-participate-read-repository.interface';
import { ContestParticipation } from '../entities';

@Injectable()
export class ContestParticipationReadRepository implements ContestParticipationReadRepositoryContract {
  constructor(
    @InjectRepository(ContestParticipation)
    private readonly repo: Repository<ContestParticipation>,
  ) {}

  async findOneByParam(
    param: FindOptionsWhere<ContestParticipation>,
  ): Promise<ContestParticipation | null> {
    return await this.repo.findOne({
      where: param,
    });
  }

  async findAllByContestId(contestId: number): Promise<ContestParticipation[]> {
    return await this.repo.find({
      where: { contestId },
      relations: ['user'],
    });
  }

  async countParticipants(contestId: number): Promise<number> {
    return await this.repo.count({
      where: { contestId },
    });
  }

  async findManyByContestId(
    contestId: number,
  ): Promise<ContestParticipation[]> {
    return this.repo.find({
      where: { contestId },
      relations: {
        user: true,
      },
    });
  }

  async countUniqueUsersByContestId(contestId: number): Promise<number> {
    const result = await this.repo
      .createQueryBuilder('participation')
      .select('COUNT(DISTINCT participation.userId)', 'count')
      .where('participation.contestId = :contestId', { contestId })
      .getRawOne<{ count: string }>();

    return Number(result?.count ?? 0);
  }
}
