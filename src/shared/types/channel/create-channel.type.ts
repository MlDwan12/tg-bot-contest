import { ChannelType } from 'src/shared/enums/channel';

export type CreateChannel = {
  id: number;
  telegramId?: number;
  telegramUsername?: string;
  name?: string;
  isActive: boolean;
  type?: ChannelType;
  createdAt: Date;
};
