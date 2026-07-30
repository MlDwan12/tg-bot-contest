import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  BOT_MESSAGE_REPOSITORY,
  CONTEST_PARTICIPATE_REPOSITORY,
  CONTEST_REPOSITORY,
} from 'src/common/constants';
import type {
  IBotMessageRepository,
  IContestParticipationRepository,
  IContestRepository,
} from '../interfaces';
import { BotMessageStatus, BotMessageType } from 'src/common/enums/bot';
import {
  ContestWinnerStatus,
  ParticipationSubscriptionStatus,
} from 'src/common/enums/contest';
import { ContestStatsDto } from '../dto/contest-stats.dto';
import { ContestWinnerService } from './contest-winner.service';

/**
 * Read-model конкурса: качество аудитории (сколько отсеялось на перепроверке
 * подписки) и доставка уведомлений победителям. Отдельный сервис, потому что
 * это чистое чтение поперёк трёх агрегатов и в логику завершения не входит.
 */
@Injectable()
export class ContestStatsService {
  constructor(
    @Inject(CONTEST_REPOSITORY)
    private readonly contestRepo: IContestRepository,

    @Inject(CONTEST_PARTICIPATE_REPOSITORY)
    private readonly contestParticipationRepo: IContestParticipationRepository,

    @Inject(BOT_MESSAGE_REPOSITORY)
    private readonly botMessageRepo: IBotMessageRepository,

    private readonly contestWinnerService: ContestWinnerService,
  ) {}

  async getContestStats(contestId: number): Promise<ContestStatsDto> {
    const contest = await this.contestRepo.findByParams({ id: contestId });

    if (!contest) {
      throw new NotFoundException('Конкурс не найден');
    }

    const [participants, winners, deliveredIds, failedIds] = await Promise.all([
      this.contestParticipationRepo.countBySubscriptionStatus(contestId),
      this.contestWinnerService.getContestWinners(contestId),
      this.botMessageRepo.findUserIdsByStatus(
        contestId,
        BotMessageType.CONTEST_WINNER,
        BotMessageStatus.SENT,
      ),
      this.botMessageRepo.findUserIdsByStatus(
        contestId,
        BotMessageType.CONTEST_WINNER,
        BotMessageStatus.FAILED,
      ),
    ]);

    const valid = participants[ParticipationSubscriptionStatus.VALID];
    const unsubscribed =
      participants[ParticipationSubscriptionStatus.UNSUBSCRIBED];

    const countByStatus = (status: ContestWinnerStatus) =>
      winners.filter((winner) => winner.status === status).length;

    // Место считаем закрытым, пока за ним стоит живой победитель: подтвердивший
    // либо ещё думающий. Отказ и просрочка место освобождают, поэтому в
    // сравнении с prizePlaces сразу видно, где приз завис без хозяина.
    const filledPlaces = new Set(
      winners
        .filter(
          (winner) =>
            winner.status === ContestWinnerStatus.CONFIRMED ||
            winner.status === ContestWinnerStatus.PENDING_CONFIRMATION,
        )
        .map((winner) => winner.place),
    );

    return {
      contestId,
      participantsTotal: valid + unsubscribed,
      participantsValid: valid,
      participantsUnsubscribed: unsubscribed,
      subscriptionsCheckedAt: contest.subscriptionsCheckedAt ?? null,
      winnersTotal: winners.length,
      winnersConfirmed: countByStatus(ContestWinnerStatus.CONFIRMED),
      winnersPending: countByStatus(ContestWinnerStatus.PENDING_CONFIRMATION),
      winnersDeclined: countByStatus(ContestWinnerStatus.DECLINED),
      winnersExpired: countByStatus(ContestWinnerStatus.EXPIRED),
      placesFilled: filledPlaces.size,
      prizePlaces: contest.prizePlaces,
      notificationsDelivered: deliveredIds.length,
      notificationsFailed: failedIds.length,
    };
  }
}
