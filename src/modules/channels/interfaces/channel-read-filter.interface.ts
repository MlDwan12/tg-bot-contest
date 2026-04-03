import { ChannelType } from 'src/shared/enums/channel';

export interface IChannelReadFilters {
  type?: ChannelType;
  isActive?: boolean;
}

export interface IChannelPaginationParams {
  page: number;
  limit: number;
  skip: number;
  take: number;
}
