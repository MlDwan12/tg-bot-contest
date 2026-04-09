import { ContestStatus, PublicationStatus } from 'src/shared/enums/contest';
import { Contest, ContestParticipation, ContestPublication } from '../entities';
import { IContestReadFilters } from './contest-filter.interface';
import { Paginated } from 'src/shared/commons/response/paginated.type';

export interface IContestReadRepository {
  findById(id: number): Promise<Contest | null>;

  findByIdWithRelations(id: number): Promise<Contest | null>;

  findPublishedPublicationsByContestId(
    contestId: number,
  ): Promise<ContestPublication[]>;

  findMany(filters?: IContestReadFilters): Promise<Paginated<Contest>>;

  findManyShortInfo(
    filters?: IContestReadFilters,
  ): Promise<Paginated<Partial<Contest>>>;

  findByStatus(status: ContestStatus): Promise<Contest[]>;

  findActive(): Promise<Contest[]>;

  findFinished(): Promise<Contest[]>;

  /**
   * Универсальный поиск (то, что ты уже вызываешь из сервиса).
   * Должен уметь хотя бы: id, status (и можно расширять).
   */
  findByParams(
    params: Partial<Pick<Contest, 'id' | 'status'>>,
  ): Promise<Contest | null>;

  // publications (для очередей)
  /**
   * Вернуть id публикаций по статусу для конкурса/нескольких конкурсов.
   * Нужно для постановки sendPublication jobs.
   */
  getPublicationIdsByStatus(
    contestIdOrIds: number | number[],
    status: PublicationStatus,
  ): Promise<number[]>;

  /**
   * Иногда полезно для диагностики/повторной отправки.
   */
  findPublicationById(id: number): Promise<ContestPublication | null>;

  // participants (для finish flow)
  /**
   * Кол-во участников конкурса.
   */
  // countParticipants(contestId: number): Promise<number>;

  /**
   * Вернуть id пользователей-участников (MVP способ выбрать победителей).
   * Для high-load позже оптимизируем.
   */
  // findParticipantUserIds(contestId: number): Promise<number[]>;

  /**
   * Получить участия (если надо для winner selection/аналитики).
   */
  // findParticipations(contestId: number): Promise<ContestParticipation[]>;
}
