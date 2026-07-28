import { WinnerStrategy } from 'src/common/enums/contest';

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

  /**
   * Перепроверять ли подписку на обязательные каналы перед розыгрышем.
   * Не задано → true: отписавшийся после участия не должен выигрывать.
   */
  recheckSubscriptionOnFinish?: boolean;

  // Каналы
  publishChannelIds?: number[];
  requiredChannelIds?: number[];
};
