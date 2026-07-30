import {
  ContestStatus,
  WinnerStrategy,
  ContestWinnerStatus,
} from 'src/common/enums/contest';
import { ChannelPlatform } from 'src/common/enums/channel';

/**
 * Обогащённый DTO-подобный результат `findByIdWithRelations` — НЕ entity, а
 * плоская проекция конкурса со связями (каналы/участники/публикации/победители),
 * которую строит репозиторий. Раньше метод возвращал `any`; тип фиксирует форму.
 */
export type ContestChannelInfo = {
  platform: ChannelPlatform;
  externalId: string | null;
  externalUsername: string | null;
  /** @deprecated переходный период — используй externalId. Заполнено только для platform=telegram. */
  telegramId: number | null;
  /** @deprecated переходный период — используй externalUsername. */
  telegramUsername: string | null;
};

export type ContestUserInfo = {
  id: number;
  telegramId: string | null;
  username: string | null;
};

/** У победителя user может быть синтетическим (фиктивный ник → id/telegramId = null). */
export type ContestWinnerUserInfo = {
  id: number | null;
  telegramId: string | null;
  username: string | null;
};

export type ContestParticipantInfo = {
  id: number;
  groupId: string | null;
  isWinner: boolean;
  prizePlace: number | null;
  joinedAt: Date | null;
  user: ContestUserInfo | null;
};

export type ContestPublicationInfo = {
  id: number;
  chatId: number;
  telegramMessageId: number | null;
  payload: {
    buttonUrl: string;
    buttonText: string;
  };
};

export type ContestWinnerInfo = {
  id: number;
  userId: number | null;
  place: number;
  /**
   * Состояние выдачи приза. Без него выдача врала бы: после автодобора на одном
   * месте лежит несколько строк (отказавшийся + занявший место), и отличить их
   * снаружи было нечем.
   */
  status: ContestWinnerStatus;
  user: ContestWinnerUserInfo | null;
};

export type ContestWithRelations = {
  id: number;
  publishChannels: ContestChannelInfo[];
  requiredChannels: ContestChannelInfo[];
  // creator = username создателя; username опционален → допускаем undefined.
  creator: string | null | undefined;
  name: string;
  description: string | null;
  imagePath: string | null;
  buttonText: string | null;
  participants: ContestParticipantInfo[];
  publications: ContestPublicationInfo[];
  winnerStrategy: WinnerStrategy;
  prizePlaces: number;
  winners: ContestWinnerInfo[];
  createdAt: Date;
  startDate: Date;
  endDate: Date;
  status: ContestStatus;
  recheckSubscriptionOnFinish: boolean;
  subscriptionsCheckedAt: Date | null;
  requireWinnerConfirmation: boolean;
  confirmationHours: number;
};
