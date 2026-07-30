import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContestParticipation } from '../entities';
import { User } from 'src/modules/users/entities';
import { ContestWinnerStatus, WinnerStrategy } from 'src/common/enums/contest';
import {
  CONTEST_PARTICIPATE_REPOSITORY,
  CONTEST_WINNER_REPOSITORY,
} from 'src/common/constants';
import type {
  IContestParticipationRepository,
  IContestWinnerRepository,
} from '../interfaces';
import { ContestWinnerAuditRepository } from '../repositories';
import {
  DRAW_ALGORITHM,
  generateSeed,
  seededShuffle,
} from './seeded-draw.util';

/**
 * Минимальный контекст розыгрыша/сохранения победителей — только те поля, что
 * реально читает winner-сервис. Структурно ему подходят и entity Contest, и
 * обогащённый ContestWithRelations (из findByIdWithRelations).
 */
export interface WinnerDrawContext {
  id: number;
  prizePlaces: number;
  winnerStrategy: WinnerStrategy;

  /**
   * Требуется ли подтверждение приза. Поля опциональны: старые вызовы и тесты,
   * не знающие про Ш10, продолжают работать — победитель сразу CONFIRMED.
   */
  requireWinnerConfirmation?: boolean;
  confirmationHours?: number;
}

/** Срок подтверждения, если у конкурса он не задан. */
const DEFAULT_CONFIRMATION_HOURS = 24;

@Injectable()
export class ContestWinnerService {
  constructor(
    @Inject(CONTEST_WINNER_REPOSITORY)
    private readonly contestWinnerRepo: IContestWinnerRepository,

    @Inject(CONTEST_PARTICIPATE_REPOSITORY)
    private readonly contestParticipationRepo: IContestParticipationRepository,

    private readonly contestWinnerAuditRepo: ContestWinnerAuditRepository,
  ) {}

  async getContestWinners(contestId: number) {
    return this.contestWinnerRepo.findByContestId(contestId);
  }

  /**
   * Пишет неизменяемый след подотчётности MANUAL-назначения: КТО (actorUserId)
   * назначил КАКИХ победителей и КОГДА. У MANUAL нет алгоритмической честности
   * (выбирает человек) — доказываем легитимность записью. Только аудит, без
   * персиста победителей: тот делает вызывающий код своим рабочим путём.
   */
  async recordManualAssignment(
    contestId: number,
    winnerUserIds: number[],
    prizePlaces: number,
    actorUserId?: number,
    fictitiousUsernames: string[] = [],
  ): Promise<void> {
    // Фиктивные победители (ник без TG-аккаунта) не имеют userId и не влезают
    // в winnerUserIds — фиксируем их ники в note, чтобы след «кто каких назначил»
    // не терял выдуманных.
    const note = fictitiousUsernames.length
      ? `Фиктивные победители: ${fictitiousUsernames.join(', ')}`
      : null;

    await this.contestWinnerAuditRepo.record({
      contestId,
      strategy: WinnerStrategy.MANUAL,
      prizePlaces,
      winnerUserIds,
      assignedByUserId: actorUserId ?? null,
      note,
    });
  }

  // Приватный: единственный корректный вход в розыгрыш — resolveAndSaveWinners,
  // который ДО этого вызова короткозамыкается на уже записанных победителях
  // (fake-safe). Прямой вызов в обход обошёл бы эту защиту и упёрся бы в
  // resolveManualWinners, несовместимый с фиктивными победителями (user=null).
  private async resolveWinners(contest: WinnerDrawContext): Promise<User[]> {
    if (!contest) {
      throw new NotFoundException('Конкурс не найден');
    }

    if (!contest.prizePlaces || contest.prizePlaces < 1) {
      throw new BadRequestException(
        'Для конкурса должно быть указано корректное количество призовых мест',
      );
    }
    switch (contest.winnerStrategy) {
      case WinnerStrategy.MANUAL:
        return this.resolveManualWinners(contest);

      default:
        return this.resolveAutomaticWinners(contest);
    }
  }

  async saveResolvedWinners(
    contestId: number,
    users: User[],
    prizePlaces: number,
    confirmation?: { required?: boolean; hours?: number },
  ): Promise<void> {
    const rows = this.toWinnerRows(contestId, users, confirmation);
    this.validateWinnerRows(rows, prizePlaces);
    await this.contestWinnerRepo.replace(contestId, rows);
  }

  async replaceManualWinners(
    contestId: number,
    winners: Array<{
      userId: number;
      place: number;
    }>,
    prizePlaces: number,
  ): Promise<void> {
    this.validateWinnerRows(winners, prizePlaces);

    await this.contestWinnerRepo.replace(
      contestId,
      winners.map((winner) => ({
        contestId,
        userId: winner.userId,
        place: winner.place,
      })),
    );
  }

  private async resolveAutomaticWinners(
    contest: WinnerDrawContext,
  ): Promise<User[]> {
    // Только прошедшие перепроверку подписки: отписавшийся после участия в
    // розыгрыше не участвует. Пока перепроверка не проводилась, все участия
    // VALID и выборка совпадает с прежней.
    const participants =
      await this.contestParticipationRepo.findEligibleByContestId(contest.id);

    if (!participants.length) {
      throw new BadRequestException(
        'Невозможно определить победителей: у конкурса нет участников',
      );
    }

    const uniqueUsers = this.extractUniqueUsersFromParticipants(participants);

    if (!uniqueUsers.length) {
      throw new BadRequestException(
        'Невозможно определить победителей: участники конкурса не найдены',
      );
    }

    if (uniqueUsers.length < contest.prizePlaces) {
      throw new BadRequestException(
        'Количество участников меньше количества призовых мест',
      );
    }

    // Provably-fair: канонический порядок пула (по userId) → детерминированный
    // shuffle от крипто-случайного seed. Порядок строк в БД на результат не влияет.
    const pool = [...uniqueUsers].sort((a, b) => a.id - b.id);
    const seed = generateSeed();
    const winners = seededShuffle(pool, seed).slice(0, contest.prizePlaces);

    // Неизменяемый след: любой пересчитает winners = shuffle(seed, pool) и
    // убедится, что розыгрыш не подкручен. Fail-closed: если след не записался,
    // розыгрыш не состоится (для дорогих призов «нет аудита — нет розыгрыша»).
    await this.contestWinnerAuditRepo.record({
      contestId: contest.id,
      strategy: contest.winnerStrategy,
      prizePlaces: contest.prizePlaces,
      winnerUserIds: winners.map((user) => user.id),
      seed,
      algorithm: DRAW_ALGORITHM,
      participantUserIds: pool.map((user) => user.id),
    });

    return winners;
  }

  /**
   * MANUAL: победители заранее записаны в contest_winners оператором. Читаем их
   * из БД (findByContestId), а не из переданного объекта. Прежняя ветка
   * `contest.winners?.length ? ...` была недостижима: resolveAndSaveWinners для
   * MANUAL короткозамыкается на существующих победителях ДО этого вызова —
   * поэтому сюда попадаем только с пустым списком (→ 400).
   */
  private async resolveManualWinners(
    contest: WinnerDrawContext,
  ): Promise<User[]> {
    const winners = await this.contestWinnerRepo.findByContestId(contest.id);

    if (!winners.length) {
      throw new BadRequestException(
        'Для manual-стратегии у конкурса должны быть заранее указаны победители',
      );
    }

    const normalized = winners.map((winner) => {
      const user = winner.user;

      if (!user) {
        throw new BadRequestException(
          'У одного из победителей не загружен пользователь',
        );
      }

      const userId = winner.userId ?? user.id;

      if (!userId) {
        throw new BadRequestException(
          'У одного из победителей отсутствует userId',
        );
      }

      return {
        user,
        row: {
          userId,
          place: winner.place,
        },
      };
    });

    this.validateWinnerRows(
      normalized.map((item) => item.row),
      contest.prizePlaces,
    );

    return normalized.map((item) => item.user);
  }

  /**
   * Строки победителей. Когда подтверждение не требуется, status и дедлайн не
   * заполняем вовсе — БД проставит DEFAULT 'confirmed', и конкурс идёт ровно
   * как до Ш10.
   *
   * Дедлайн считаем от МОМЕНТА СОХРАНЕНИЯ, а не от endDate конкурса: финиш
   * может задержаться (grace-период, перепроверка подписок идёт минутами), и
   * отсчёт от endDate съел бы у победителя часть срока, а то и весь.
   */
  private toWinnerRows(
    contestId: number,
    users: User[],
    confirmation?: { required?: boolean; hours?: number },
  ) {
    if (!confirmation?.required) {
      return users.map((user, index) => ({
        contestId,
        userId: user.id,
        place: index + 1,
      }));
    }

    const hours = confirmation.hours ?? DEFAULT_CONFIRMATION_HOURS;
    const deadline = new Date(Date.now() + hours * 60 * 60 * 1000);

    return users.map((user, index) => ({
      contestId,
      userId: user.id,
      place: index + 1,
      status: ContestWinnerStatus.PENDING_CONFIRMATION,
      confirmationDeadline: deadline,
    }));
  }

  private extractUniqueUsersFromParticipants(
    participants: ContestParticipation[],
  ): User[] {
    const usersMap = new Map<number, User>();

    for (const participant of participants) {
      if (participant.user) {
        usersMap.set(participant.user.id, participant.user);
      }
    }

    return Array.from(usersMap.values());
  }

  private validateWinnerRows(
    winners: Array<{ userId: number; place: number }>,
    prizePlaces: number,
  ): void {
    if (winners.length !== prizePlaces) {
      throw new BadRequestException(
        'Количество победителей не соответствует количеству призовых мест',
      );
    }

    const userIds = winners.map((winner) => winner.userId);
    const places = winners.map((winner) => winner.place);

    const uniqueUserIds = new Set(userIds);
    if (uniqueUserIds.size !== userIds.length) {
      throw new BadRequestException(
        'Один и тот же пользователь указан среди победителей несколько раз',
      );
    }

    const uniquePlaces = new Set(places);
    if (uniquePlaces.size !== places.length) {
      throw new BadRequestException('Места победителей должны быть уникальны');
    }

    const invalidPlace = places.find(
      (place) => place < 1 || place > prizePlaces,
    );

    if (invalidPlace !== undefined) {
      throw new BadRequestException(
        `Место победителя должно быть в диапазоне от 1 до ${prizePlaces}`,
      );
    }
  }

  async resolveAndSaveWinners(contest: WinnerDrawContext): Promise<void> {
    const existingWinners = await this.contestWinnerRepo.findByContestId(
      contest.id,
    );
    if (existingWinners.length > 0) {
      // Место берём из самой строки победителя (winner.place), а НЕ из индекса
      // отфильтрованного массива: у фиктивного победителя (ник без TG) user=null,
      // после его отсева индексы сдвигаются и реальный победитель получил бы
      // чужое место в participants.prizePlace. Фиктивных в participants нет —
      // синхронизируем флаги только по реальным, но с их настоящими местами.
      const winnerFlags = existingWinners
        .filter((w) => w.user != null)
        .map((w) => ({ userId: (w.user as User).id, place: w.place }));
      await this.contestParticipationRepo.syncWinnerFlagsInTransaction(
        contest.id,
        winnerFlags,
      );
      return;
    }

    const users = await this.resolveWinners(contest);
    // Подтверждение только для RANDOM: у MANUAL победителей назначает оператор
    // (другим путём — contestRepo.replaceWinners), и порядка жеребьёвки, из
    // которого берётся замена, там не существует.
    const confirmation =
      contest.winnerStrategy === WinnerStrategy.RANDOM
        ? {
            required: contest.requireWinnerConfirmation,
            hours: contest.confirmationHours,
          }
        : undefined;

    await this.saveResolvedWinners(
      contest.id,
      users,
      contest.prizePlaces,
      confirmation,
    );
    await this.syncParticipantsWithResolvedWinners(contest.id, users);
  }

  private async syncParticipantsWithResolvedWinners(
    contestId: number,
    users: User[],
  ): Promise<void> {
    const winners = users.map((user, index) => ({
      userId: user.id,
      place: index + 1,
    }));

    await this.contestParticipationRepo.syncWinnerFlagsInTransaction(
      contestId,
      winners,
    );
  }
}
