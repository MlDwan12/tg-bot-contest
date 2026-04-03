import { ContestWinner } from '../entities';

export abstract class ContestWinnerReadRepository {
  abstract findByContestId(contestId: number): Promise<ContestWinner[]>;
}
