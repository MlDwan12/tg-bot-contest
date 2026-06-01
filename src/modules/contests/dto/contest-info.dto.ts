import { WinnerStrategy, ContestStatus } from 'src/shared/enums/contest';

type ContestRelationChannel = {
  telegramId: number | null;
  telegramUsername: string | null;
};

type ContestRelationUser = {
  id: number;
  telegramId: string | null;
  username: string | null;
};

type ContestDetailsParticipant = {
  id: number;
  groupId: string | null;
  isWinner: boolean;
  prizePlace: number | null;
  joinedAt: Date | null;
  user: ContestRelationUser | null;
};

type ContestDetailsPublication = {
  id: number;
  chatId: number;
  telegramMessageId: number | null;
  payload: {
    buttonUrl: string;
    buttonText: string;
  };
};

type ContestDetailsWinner = {
  id: number;
  user: ContestRelationUser | null;
};

export type ContestDetails = {
  id: number;
  publishChannels: ContestRelationChannel[];
  requiredChannels: ContestRelationChannel[];
  creator: string | null;
  name: string;
  description: string | null;
  imagePath: string | null;
  buttonText: string | null;
  participants: ContestDetailsParticipant[];
  publications: ContestDetailsPublication[];
  winnerStrategy: WinnerStrategy;
  prizePlaces: number;
  winners: ContestDetailsWinner[];
  createdAt: Date;
  startDate: Date;
  endDate: Date;
  status: ContestStatus;
};
