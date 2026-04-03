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
import { ContestParticipationWriteRepository } from '../repositories';

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
  ) {}

  async getContestWinners(contestId: number) {
    return this.contestWinnerReadRepo.findByContestId(contestId);
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

    const shuffledUsers = this.shuffleArray(uniqueUsers);

    return shuffledUsers.slice(0, contest.prizePlaces);
  }

  private async resolveManualWinners(contest: Contest): Promise<User[]> {
    const winners = contest.winners?.length
      ? contest.winners
      : await this.contestWinnerReadRepo.findByContestId(contest.id);

    if (!winners.length) {
      throw new BadRequestException(
        'Для manual-стратегии у конкурса должны быть заранее указаны победители',
      );
    }

    this.validateWinnerRows(
      winners.map((winner) => ({
        userId: winner.userId,
        place: winner.place,
      })),
      contest.prizePlaces,
    );

    return winners.map((winner) => {
      if (!winner.user) {
        throw new BadRequestException(
          'У одного из победителей не загружен пользователь',
        );
      }

      return winner.user;
    });
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
    if (winners.length > prizePlaces) {
      throw new BadRequestException(
        'Количество победителей не может быть больше prizePlaces',
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

    if (invalidPlace) {
      throw new BadRequestException(
        `Место победителя должно быть в диапазоне от 1 до ${prizePlaces}`,
      );
    }
  }

  private shuffleArray<T>(items: T[]): T[] {
    const array = [...items];

    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }

    return array;
  }

  async resolveAndSaveWinners(contest: Contest): Promise<void> {
    const users = await this.resolveWinners(contest);

    await this.saveResolvedWinners(contest.id, users, contest.prizePlaces);

    await this.syncParticipantsWithResolvedWinners(contest.id, users);
  }

  private async syncParticipantsWithResolvedWinners(
    contestId: number,
    users: User[],
  ): Promise<void> {
    await this.contestParticipationWriteRepo.resetWinnerFlags(contestId);

    for (const [index, user] of users.entries()) {
      await this.contestParticipationWriteRepo.markAsWinner(
        contestId,
        user.id,
        index + 1,
      );
    }
  }
}
