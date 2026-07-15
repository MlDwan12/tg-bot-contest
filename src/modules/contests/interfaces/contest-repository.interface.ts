import { FindOptionsWhere } from 'typeorm';
import { ContestStatus, PublicationStatus } from 'src/common/enums/contest';
import { Contest, ContestPublication } from '../entities';
import { IContestReadFilters } from './contest-filter.interface';
import { Paginated } from 'src/common/response/paginated.type';
import { ContestWithRelations } from '../types';

/**
 * Единый контракт репозитория агрегата Contest (Фаза 9 — слиты read+write).
 * Сервисы зависят от этой абстракции через токен CONTEST_REPOSITORY.
 * Составлен по ФАКТИЧЕСКОЙ реализации ContestRepository (объединяет всё,
 * что раньше было раздроблено по read/write интерфейсам, включая методы,
 * которых в старых интерфейсах не было, но сервисы их вызывали).
 */
export interface IContestRepository {
  // ── чтение: конкурс ──────────────────────────────────────────────────────
  findById(id: number): Promise<Contest | null>;
  findByParams(params: FindOptionsWhere<Contest>): Promise<Contest | null>;
  // findByIdWithRelations возвращает обогащённый DTO-подобный объект, не entity.
  findByIdWithRelations(id: number): Promise<ContestWithRelations | null>;
  findMany(filters?: IContestReadFilters): Promise<Paginated<Contest>>;
  findManyShortInfo(
    filters?: IContestReadFilters,
  ): Promise<Paginated<Partial<any>>>;
  findByStatus(status: ContestStatus): Promise<Contest[]>;
  findActive(): Promise<Contest[]>;
  findFinished(): Promise<Contest[]>;

  // ── чтение: публикации ───────────────────────────────────────────────────
  findPublicationById(id: number): Promise<ContestPublication | null>;
  findPublicationByContestId(
    contestId: number,
  ): Promise<ContestPublication | null>;
  findPublicationsByContestId(contestId: number): Promise<ContestPublication[]>;
  findPublishedPublicationsByContestId(
    contestId: number,
  ): Promise<ContestPublication[]>;
  getPublicationIdsByStatus(
    contestIdOrIds: number | number[],
    status: PublicationStatus,
  ): Promise<number[]>;
  findPublicationForButtonUpdate(publicationId: number): Promise<{
    id: number;
    contestId: number;
    chatId: number;
    telegramMessageId?: number;
  } | null>;
  findPublishedPublicationIdsForContest(
    contestId: number,
  ): Promise<ContestPublication[]>;

  // ── запись: конкурс ──────────────────────────────────────────────────────
  create(data: Partial<Contest>): Promise<Contest>;
  update(id: number, data: Partial<Contest>): Promise<Contest>;
  delete(id: number): Promise<void>;
  setStatus(id: number, status: ContestStatus): Promise<void>;
  updateStatusIfCurrent(
    contestId: number,
    current: ContestStatus,
    next: ContestStatus,
  ): Promise<boolean>;
  updateStatusIfNotCompleted(contestId: number): Promise<boolean>;
  setPublishChannels(contestId: number, channelIds: number[]): Promise<void>;
  setRequiredChannels(contestId: number, channelIds: number[]): Promise<void>;
  replaceWinners(
    contestId: number,
    winners: Array<{
      contestId: number;
      userId: number | null;
      place: number;
      displayUsername?: string | null;
    }>,
  ): Promise<void>;

  // ── запись: публикации ───────────────────────────────────────────────────
  createPublications(data: Partial<ContestPublication>[]): Promise<void>;
  claimPublication(publicationId: number): Promise<ContestPublication | null>;
  markPublicationPublished(
    publicationId: number,
    data: { telegramMessageId: number; publishedAt: Date },
  ): Promise<void>;
  markPublicationFailed(
    publicationId: number,
    data: { error: string },
  ): Promise<void>;
  bumpPublicationError(
    publicationId: number,
    data: { error: string },
  ): Promise<void>;
  requeueStalePublications(staleMinutes: number): Promise<number>;
  findPendingPublicationIdsForActiveContests(limit: number): Promise<number[]>;
  cancelPendingPublications(contestId: number): Promise<void>;
  deletePendingPublicationsByContestId(contestId: number): Promise<void>;
  updatePublication(
    publicationId: number,
    data: Partial<ContestPublication>,
  ): Promise<void>;
}
