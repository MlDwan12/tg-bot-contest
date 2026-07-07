import { ContestParticipation } from '../entities';

export interface IContestParticipationWriteRepository {
  createParticipation(data: {
    contestId: number;
    userId: number;
    groupId: string;
  }): Promise<ContestParticipation>;

  syncWinnerFlagsInTransaction(
    contestId: number,
    winners: Array<{ userId: number; place: number }>,
  ): Promise<void>;
}
