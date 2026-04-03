import { ContestParticipation, ContestPublication } from '../entities';

export interface IContestParticipationWriteRepository {
  createParticipation(data: {
    contestId: number;
    userId: number;
    groupId: string;
  }): Promise<ContestParticipation>;

  
}
