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

  /**
   * Требовать ли подтверждение приза победителем. Не задано → false: конкурс
   * идёт как до Ш10. Включение — единственный способ освободить место, без
   * него автодобор не срабатывает никогда.
   */
  requireWinnerConfirmation?: boolean;

  /** Срок подтверждения в часах. Не задано → 24. */
  confirmationHours?: number;

  // Каналы
  publishChannelIds?: number[];
  requiredChannelIds?: number[];
};
