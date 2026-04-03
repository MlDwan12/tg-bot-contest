import { ContestStatus } from 'src/shared/enums/contest';

export class ContestShortInfoDto {
  id: number;
  name: string;
  creator_userName: string;
  participantCount: number;
  status: ContestStatus;
  startDate: Date;
  endDate: Date;
}
