import { ChannelPlatform, ChannelType } from 'src/common/enums/channel';

export type CreateChannel = {
  id: number;
  platform: ChannelPlatform;
  externalId?: string;
  externalUsername?: string;
  name?: string;
  isActive: boolean;
  type?: ChannelType;
  createdAt: Date;
};
