import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Contest, ContestParticipation } from '../entities';
import { User } from 'src/modules/users/entities';
import { WinnerStrategy } from 'src/shared/enums/contest';
import {
  CONTEST_PARTICIPATE_READ_REPOSITORY,
  CONTEST_PARTICIPATE_WRITE_REPOSITORY,
  CONTEST_WINNER_READ_REPOSITORY,
  CONTEST_WINNER_WRITE_REPOSITORY,
} from 'src/shared/commons/constants';
import {
  ContestParticipationReadRepository,
  ContestWinnerReadRepository,
  ContestWinnerWriteRepository,
} from '../interfaces';
import {
  ContestParticipationWriteRepository,
  ContestWinnerAuditWriteRepository,
} from '../repositories';
import {
  DRAW_ALGORITHM,
  generateSeed,
  seededShuffle,
} from './seeded-draw.util';

@Injectable()
export class ContestWinnerService {
  constructor(
    @Inject(CONTEST_WINNER_READ_REPOSITORY)
    private readonly contestWinnerReadRepo: ContestWinnerReadRepository,

    @Inject(CONTEST_WINNER_WRITE_REPOSITORY)
    private readonly contestWinnerWriteRepo: ContestWinnerWriteRepository,

    @Inject(CONTEST_PARTICIPATE_READ_REPOSITORY)
    private readonly contestParticipationReadRepo: ContestParticipationReadRepository,

    @Inject(CONTEST_PARTICIPATE_WRITE_REPOSITORY)
    private readonly contestParticipationWriteRepo: ContestParticipationWriteRepository,

    private readonly contestWinnerAuditWriteRepo: ContestWinnerAuditWriteRepository,
  ) {}

  async getContestWinners(contestId: number) {
    return this.contestWinnerReadRepo.findByContestId(contestId);
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
  ): Promise<void> {
    await this.contestWinnerAuditWriteRepo.record({
      contestId,
      strategy: WinnerStrategy.MANUAL,
      prizePlaces,
      winnerUserIds,
      assignedByUserId: actorUserId ?? null,
    });
  }

  async resolveWinners(contest: Contest): Promise<User[]> {
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
    await this.contestWinnerWriteRepo.replace(contestId, rows);
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

    await this.contestWinnerWriteRepo.replace(
      contestId,
      winners.map((winner) => ({
        contestId,
        userId: winner.userId,
        place: winner.place,
      })),
    );
  }

  private async resolveAutomaticWinners(contest: Contest): Promise<User[]> {
    const participants =
      await this.contestParticipationReadRepo.findManyByContestId(contest.id);

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

  // private async resolveManualWinners(contest: Contest): Promise<User[]> {
  //   const winners = contest.winners?.length
  //     ? contest.winners
  //     : await this.contestWinnerReadRepo.findByContestId(contest.id);

  //   if (!winners.length) {
  //     throw new BadRequestException(
  //       'Для manual-стратегии у конкурса должны быть заранее указаны победители',
  //     );
  //   }

  //   this.validateWinnerRows(
  //     winners.map((winner) => ({
  //       userId: winner.userId,
  //       place: winner.place,
  //     })),
  //     contest.prizePlaces,
  //   );

  //   return winners.map((winner) => {
  //     if (!winner.user) {
  //       throw new BadRequestException(
  //         'У одного из победителей не загружен пользователь',
  //       );
  //     }

  //     return winner.user;
  //   });
  // }

  private async resolveManualWinners(contest: Contest): Promise<User[]> {
    const winners = contest.winners?.length
      ? contest.winners
      : await this.contestWinnerReadRepo.findByContestId(contest.id);

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

  async resolveAndSaveWinners(contest: Contest): Promise<void> {
    const existingWinners = await this.contestWinnerReadRepo.findByContestId(
      contest.id,
    );
    if (existingWinners.length > 0) {
      const users = existingWinners
        .map((w) => w.user)
        .filter((u): u is User => u != null);
      await this.syncParticipantsWithResolvedWinners(contest.id, users);
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

    await this.contestParticipationWriteRepo.syncWinnerFlagsInTransaction(
      contestId,
      winners,
    );
  }
}
