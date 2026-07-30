import {
  ContestStatus,
  WinnerStrategy,
  ContestWinnerStatus,
} from 'src/common/enums/contest';
import { ChannelPlatform } from 'src/common/enums/channel';

/**
 * Только для Swagger: `ContestWithRelations` (src/modules/contests/types)
 * — плоский `type`, плагин swagger не может интроспектировать TS type alias,
 * только классы. Эти классы описывают ровно ту же форму под документацию;
 * контроллер продолжает возвращать сам `type`, эти классы в рантайме не
 * участвуют.
 */
export class ContestChannelInfoDto {
  platform: ChannelPlatform;
  externalId: string | null;
  externalUsername: string | null;
  /** @deprecated переходный период — используй externalId. Заполнено только для platform=telegram. */
  telegramId: number | null;
  /** @deprecated переходный период — используй externalUsername. */
  telegramUsername: string | null;
}

export class ContestUserInfoDto {
  id: number;
  telegramId: string | null;
  username: string | null;
}

/** У победителя user может быть синтетическим (фиктивный ник → id/telegramId = null). */
export class ContestWinnerUserInfoDto {
  id: number | null;
  telegramId: string | null;
  username: string | null;
}

export class ContestParticipantInfoDto {
  id: number;
  groupId: string | null;
  isWinner: boolean;
  prizePlace: number | null;
  joinedAt: Date | null;
  user: ContestUserInfoDto | null;
}

export class ContestPublicationPayloadDto {
  buttonUrl: string;
  buttonText: string;
}

export class ContestPublicationInfoDto {
  id: number;
  chatId: number;
  telegramMessageId: number | null;
  payload: ContestPublicationPayloadDto;
}

export class ContestWinnerInfoDto {
  id: number;
  userId: number | null;
  place: number;
  /**
   * Состояние выдачи приза. Без него выдача врала бы: после автодобора на одном
   * месте лежит несколько строк (отказавшийся + занявший место), и отличить их
   * снаружи было нечем.
   */
  status: ContestWinnerStatus;
  user: ContestWinnerUserInfoDto | null;
}

export class ContestWithRelationsDto {
  id: number;
  publishChannels: ContestChannelInfoDto[];
  requiredChannels: ContestChannelInfoDto[];
  /** Username создателя конкурса. */
  creator: string | null;
  name: string;
  description: string | null;
  imagePath: string | null;
  buttonText: string | null;
  participants: ContestParticipantInfoDto[];
  publications: ContestPublicationInfoDto[];
  winnerStrategy: WinnerStrategy;
  prizePlaces: number;
  winners: ContestWinnerInfoDto[];
  createdAt: Date;
  startDate: Date;
  endDate: Date;
  status: ContestStatus;
  recheckSubscriptionOnFinish: boolean;
  subscriptionsCheckedAt: Date | null;
  requireWinnerConfirmation: boolean;
  confirmationHours: number;
}
