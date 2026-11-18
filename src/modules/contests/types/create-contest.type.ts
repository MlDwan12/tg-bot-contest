import { ResultsImageMode, WinnerStrategy } from 'src/common/enums/contest';

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

  // Пост с итогами
  resultsText?: string;
  resultsImageMode?: ResultsImageMode;

  // Каналы
  publishChannelIds?: number[];
  requiredChannelIds?: number[];
};
