import { FindOptionsWhere } from 'typeorm';
import { ContestParticipation } from '../entities';

export abstract class ContestParticipationReadRepository {
  abstract findOneByParam(
    param: FindOptionsWhere<ContestParticipation>,
  ): Promise<ContestParticipation | null>;

  abstract findAllByContestId(
    contestId: number,
  ): Promise<ContestParticipation[]>;

  abstract countParticipants(contestId: number): Promise<number>;

  abstract findManyByContestId(
    contestId: number,
  ): Promise<ContestParticipation[]>;

  abstract countUniqueUsersByContestId(contestId: number): Promise<number>;
}
