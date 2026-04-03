export abstract class ContestWinnerWriteRepository {
  abstract replace(
    contestId: number,
    winners: Array<{
      contestId: number;
      userId: number;
      place: number;
    }>,
  ): Promise<void>;

  abstract deleteByContestId(contestId: number): Promise<void>;
}
