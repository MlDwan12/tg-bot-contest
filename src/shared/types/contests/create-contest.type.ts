import { WinnerStrategy } from 'src/shared/enums/contest';

export type CreateContest = {
  // Контент для Telegram
  name: string;
  description?: string;
  // postText?: string;
  buttonText?: string;
  buttonUrl?: string;

  winnerStrategy: WinnerStrategy;
  prizePlaces: number;
  startDate: Date;
  endDate: Date;
  creatorId: number;

  // Каналы
  publishChannelIds?: number[];
  requiredChannelIds?: number[];
};
