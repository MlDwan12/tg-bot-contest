import { ContestStatus, WinnerStrategy } from 'src/shared/enums/contest';
import { ContestSortBy, SortOrder } from '../dto/get-contests-query.dto';

export interface IContestReadFilters {
  status?: ContestStatus;
  creatorId?: number;
  winnerStrategy?: WinnerStrategy;
  startDateFrom?: Date;
  startDateTo?: Date;
  endDateFrom?: Date;
  endDateTo?: Date;
  search?: string;
  sortBy?: ContestSortBy;
  sortOrder?: SortOrder;
  page?: number;
  limit?: number;
}
