import { ChannelType } from 'src/common/enums/channel';

export type CreateChannel = {
  id: number;
  telegramId?: number;
  telegramUsername?: string;
  name?: string;
  isActive: boolean;
  type?: ChannelType;
  createdAt: Date;
};
