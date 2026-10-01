import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { ContestParticipation, ContestWinner } from '../entities';
import { User } from 'src/modules/users/entities';
import { ContestStatus, WinnerStrategy } from 'src/common/enums/contest';
import {
  CONTEST_PARTICIPATE_REPOSITORY,
  CONTEST_REPOSITORY,
  CONTEST_WINNER_REPOSITORY,
} from 'src/common/constants';
import type {
  IContestParticipationRepository,
  IContestRepository,
  IContestWinnerRepository,
} from '../interfaces';
import { ContestWinnerAuditWriteRepository } from '../repositories';
import { UsersService } from 'src/modules/users/services/users.service';
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
}

/**
 * Вход для replaceCompletedContestWinner — доменный тип, отдельный от
 * ReplaceContestWinnerDto (см. dto/replace-contest-winner.dto.ts): DTO живёт
 * в контроллере, сервис работает со своим типом (см. [[dto-vs-domain-type-boundary]]).
 * Структурно совпадает с DTO, поэтому контроллер передаёт его как есть.
 */
export interface ReplaceCompletedWinnerInput {
  currentTelegramId?: number;
  currentUsername?: string;
  random?: boolean;
  newTelegramId?: number;
  newUsername?: string;
}

@Injectable()
export class ContestWinnerService {
  constructor(
    @Inject(CONTEST_WINNER_REPOSITORY)
    private readonly contestWinnerRepo: IContestWinnerRepository,

    @Inject(CONTEST_PARTICIPATE_REPOSITORY)
    private readonly contestParticipationRepo: IContestParticipationRepository,

    @Inject(CONTEST_REPOSITORY)
    private readonly contestRepo: IContestRepository,

    private readonly contestWinnerAuditWriteRepo: ContestWinnerAuditWriteRepository,
    private readonly usersService: UsersService,
    private readonly logger: Logger,
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

    await this.contestWinnerAuditWriteRepo.record({
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
  ): Promise<void> {
    const rows = this.toWinnerRows(contestId, users);
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
    const participants =
      await this.contestParticipationRepo.findManyByContestId(contest.id);

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
    await this.contestWinnerAuditWriteRepo.record({
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

  private toWinnerRows(contestId: number, users: User[]) {
    return users.map((user, index) => ({
      contestId,
      userId: user.id,
      place: index + 1,
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
    await this.saveResolvedWinners(contest.id, users, contest.prizePlaces);
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

  /**
   * Точечная замена ОДНОГО победителя в УЖЕ ЗАВЕРШЁННОМ конкурсе — отдельный
   * путь от MANUAL-назначения через updateContest (тот блокирует любое
   * редактирование COMPLETED-конкурса, см. assertContestEditable в
   * contests.service.ts). Старый победитель ищется по telegramId/username
   * среди уже сохранённых в contest_winners; новый — либо конкретный (тоже по
   * telegramId/username, резолвится через UsersService), либо случайный из
   * оставшихся участников (тем же provably-fair алгоритмом, что и авто-розыгрыш).
   */
  async replaceCompletedContestWinner(
    contestId: number,
    input: ReplaceCompletedWinnerInput,
    actorUserId?: number,
  ): Promise<ContestWinner[]> {
    const contest = await this.contestRepo.findByParams({ id: contestId });

    if (!contest) {
      throw new NotFoundException('Конкурс не найден');
    }

    if (contest.status !== ContestStatus.COMPLETED) {
      throw new BadRequestException(
        'Менять победителя можно только в завершённом конкурсе',
      );
    }

    const existingWinners =
      await this.contestWinnerRepo.findByContestId(contestId);
    const target = this.findWinnerByIdentity(existingWinners, {
      telegramId: input.currentTelegramId,
      username: input.currentUsername,
    });

    const hasNewSpecific =
      input.newTelegramId !== undefined ||
      (input.newUsername !== undefined && input.newUsername !== '');

    if (Boolean(input.random) === hasNewSpecific) {
      throw new BadRequestException(
        'Нужно указать либо random: true, либо newTelegramId/newUsername — и не оба сразу',
      );
    }

    const existingWinnerUserIds = new Set(
      existingWinners
        .filter((w) => w.userId != null)
        .map((w) => w.userId as number),
    );

    let nextUser: User;
    let drawSeed: string | null = null;
    let drawPool: number[] | null = null;

    if (input.random) {
      const picked = await this.pickRandomReplacement(
        contestId,
        existingWinnerUserIds,
      );
      nextUser = picked.user;
      drawSeed = picked.seed;
      drawPool = picked.pool;
    } else {
      nextUser = await this.resolveRealUser({
        telegramId: input.newTelegramId,
        username: input.newUsername,
      });

      if (existingWinnerUserIds.has(nextUser.id)) {
        throw new BadRequestException(
          'Этот пользователь уже является победителем на другом месте',
        );
      }
    }

    const updatedRows = existingWinners.map((w) =>
      w.place === target.place
        ? {
            contestId,
            userId: nextUser.id,
            place: target.place,
            displayUsername: null,
          }
        : {
            contestId,
            userId: w.userId,
            place: w.place,
            displayUsername: w.displayUsername,
          },
    );

    await this.contestRepo.replaceWinners(contestId, updatedRows);
    await this.syncParticipantFlagsFromStoredWinners(contestId);

    const describeOld = target.user
      ? `userId=${target.user.id} (@${target.user.username ?? target.user.telegramId})`
      : `@${target.displayUsername}`;

    try {
      await this.contestWinnerAuditWriteRepo.record({
        contestId,
        strategy: input.random ? WinnerStrategy.RANDOM : WinnerStrategy.MANUAL,
        prizePlaces: contest.prizePlaces,
        winnerUserIds: [nextUser.id],
        seed: drawSeed,
        algorithm: drawSeed ? DRAW_ALGORITHM : null,
        participantUserIds: drawPool,
        assignedByUserId: actorUserId ?? null,
        note: `Замена победителя на месте ${target.place}: ${describeOld} → userId=${nextUser.id} (@${nextUser.username ?? nextUser.telegramId})`,
      });
    } catch (error) {
      // Best-effort, как и у recordManualAssignment: замена уже выполнена,
      // потеря аудита не должна откатывать операцию — только громко логируем.
      this.logger.error(
        { err: error, contestId, place: target.place, actorUserId },
        'Не удалось записать аудит замены победителя',
      );
    }

    return this.contestWinnerRepo.findByContestId(contestId);
  }

  /** Ищет старого победителя среди уже сохранённых — по telegramId или username. */
  private findWinnerByIdentity(
    winners: ContestWinner[],
    identity: { telegramId?: number; username?: string },
  ): ContestWinner {
    const hasTelegramId =
      identity.telegramId !== undefined && identity.telegramId !== null;
    const hasUsername =
      identity.username !== undefined &&
      identity.username !== null &&
      identity.username !== '';

    if (hasTelegramId === hasUsername) {
      throw new BadRequestException(
        'Нужно указать либо currentTelegramId, либо currentUsername текущего победителя — и не оба сразу',
      );
    }

    const found = hasTelegramId
      ? winners.find((w) => w.user?.telegramId === String(identity.telegramId))
      : winners.find((w) => {
          const nick = this.normalizeUsername(identity.username as string);
          return (
            w.user?.username?.toLowerCase() === nick.toLowerCase() ||
            w.displayUsername?.toLowerCase() === nick.toLowerCase()
          );
        });

    if (!found) {
      throw new NotFoundException(
        'Победитель с таким telegramId/username не найден среди победителей этого конкурса',
      );
    }

    return found;
  }

  /** Резолвит конкретного нового победителя — только реальный юзер (не фиктивный). */
  private async resolveRealUser(input: {
    telegramId?: number;
    username?: string;
  }): Promise<User> {
    const hasTelegramId =
      input.telegramId !== undefined && input.telegramId !== null;
    const hasUsername =
      input.username !== undefined &&
      input.username !== null &&
      input.username !== '';

    if (hasTelegramId === hasUsername) {
      throw new BadRequestException(
        'Нужно указать либо newTelegramId, либо newUsername нового победителя — и не оба сразу',
      );
    }

    const user = hasTelegramId
      ? await this.usersService.findByTelegramId(String(input.telegramId))
      : await this.usersService.findOne({
          username: this.normalizeUsername(input.username as string),
        });

    if (!user) {
      const identity = hasTelegramId
        ? `telegramId ${input.telegramId}`
        : `username ${input.username}`;
      throw new NotFoundException(
        `Пользователь с ${identity} не найден — он должен хотя бы раз запустить бота`,
      );
    }

    return user;
  }

  /**
   * Провабли-фейр случайная замена: пул = уникальные участники конкурса за
   * вычетом ВСЕХ текущих победителей (включая заменяемого — иначе розыгрыш
   * может «случайно» вернуть того же человека). Тот же generateSeed +
   * seededShuffle, что и в автоматическом розыгрыше — для одинаковой
   * проверяемости следа в contest_winner_audit.
   */
  private async pickRandomReplacement(
    contestId: number,
    excludeUserIds: Set<number>,
  ): Promise<{ user: User; seed: string; pool: number[] }> {
    const participants =
      await this.contestParticipationRepo.findManyByContestId(contestId);
    const uniqueUsers = this.extractUniqueUsersFromParticipants(participants);
    const pool = uniqueUsers
      .filter((user) => !excludeUserIds.has(user.id))
      .sort((a, b) => a.id - b.id);

    if (!pool.length) {
      throw new BadRequestException(
        'Нет доступных участников для случайной замены',
      );
    }

    const seed = generateSeed();
    const [user] = seededShuffle(pool, seed);

    return { user, seed, pool: pool.map((u) => u.id) };
  }

  private normalizeUsername(username: string): string {
    return username.trim().replace(/^@+/, '').trim();
  }

  /**
   * Синхронизирует isWinner/prizePlace в contest_participants с уже
   * сохранённой таблицей contest_winners. Фиктивные победители (userId=null)
   * не имеют строки в contest_participants — синхронизируем только реальных,
   * как и в короткозамкнутой ветке resolveAndSaveWinners.
   */
  private async syncParticipantFlagsFromStoredWinners(
    contestId: number,
  ): Promise<void> {
    const winners = await this.contestWinnerRepo.findByContestId(contestId);
    const winnerFlags = winners
      .filter((w) => w.userId != null)
      .map((w) => ({ userId: w.userId as number, place: w.place }));

    await this.contestParticipationRepo.syncWinnerFlagsInTransaction(
      contestId,
      winnerFlags,
    );
  }
}
