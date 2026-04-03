import { Contest } from '../entities/contest.entity';
import { ContestStatus } from '../../../shared/enums/contest/contest-status.enum';
import { ContestPublication } from '../entities';

export abstract class IContestWriteRepository {
  abstract create(data: Partial<Contest>): Promise<Contest>;

  abstract update(id: number, data: Partial<Contest>): Promise<Contest>;

  abstract delete(id: number): Promise<void>;

  abstract setStatus(id: number, status: ContestStatus): Promise<void>;

  abstract setPublishChannels(
    contestId: number,
    channelIds: number[],
  ): Promise<void>;

  abstract setRequiredChannels(
    contestId: number,
    channelIds: number[],
  ): Promise<void>;

  abstract createPublications(
    data: Partial<ContestPublication>[],
  ): Promise<void>;

  abstract claimPublication(
    publicationId: number,
  ): Promise<ContestPublication | null>;

  abstract markPublicationPublished(
    publicationId: number,
    data: { telegramMessageId: number; publishedAt: Date },
  ): Promise<void>;

  abstract markPublicationFailed(
    publicationId: number,
    data: { error: string },
  ): Promise<void>;

  abstract bumpPublicationError(
    publicationId: number,
    data: { error: string },
  ): Promise<void>;

  abstract cancelPendingPublications(contestId: number): Promise<void>;

  abstract deletePendingPublicationsByContestId(
    contestId: number,
  ): Promise<void>;

  abstract findPublishedPublicationsByContestId(
    contestId: number,
  ): Promise<ContestPublication[]>;

  abstract updatePublication(
    publicationId: number,
    data: Partial<ContestPublication>,
  ): Promise<void>;
}
