import { ContestStatsService } from './contest-stats.service';
import {
  ContestWinnerStatus,
  ParticipationSubscriptionStatus,
} from 'src/common/enums/contest';

function winner(place: number, userId: number, status: ContestWinnerStatus) {
  return { id: 100 + userId, place, userId, status };
}

function build(options: { winners?: any[]; prizePlaces?: number } = {}) {
  const contestRepo = {
    findByParams: async () => ({
      id: 7,
      prizePlaces: options.prizePlaces ?? 2,
      subscriptionsCheckedAt: null,
    }),
  } as any;

  const contestParticipationRepo = {
    countBySubscriptionStatus: async () => ({
      [ParticipationSubscriptionStatus.VALID]: 8,
      [ParticipationSubscriptionStatus.UNSUBSCRIBED]: 2,
    }),
  } as any;

  const botMessageRepo = { findUserIdsByStatus: async () => [] } as any;

  const contestWinnerService = {
    getContestWinners: async () => options.winners ?? [],
  } as any;

  const service = new ContestStatsService(
    contestRepo,
    contestParticipationRepo,
    botMessageRepo,
    contestWinnerService,
  );

  return { service };
}

describe('ContestStatsService: статусы выдачи призов', () => {
  it('считает победителей по статусам', async () => {
    const { service } = build({
      winners: [
        winner(1, 1, ContestWinnerStatus.DECLINED),
        winner(1, 2, ContestWinnerStatus.CONFIRMED),
        winner(2, 3, ContestWinnerStatus.PENDING_CONFIRMATION),
      ],
    });

    const stats = await service.getContestStats(7);

    // Строк больше, чем мест: на месте 1 побывали двое — отказавшийся и замена.
    expect(stats.winnersTotal).toBe(3);
    expect(stats.winnersConfirmed).toBe(1);
    expect(stats.winnersPending).toBe(1);
    expect(stats.winnersDeclined).toBe(1);
    expect(stats.winnersExpired).toBe(0);

    // Оба места закрыты живыми победителями.
    expect(stats.placesFilled).toBe(2);
    expect(stats.prizePlaces).toBe(2);
  });

  it('незакрытое место видно по расхождению placesFilled и prizePlaces', async () => {
    const { service } = build({
      winners: [
        winner(1, 1, ContestWinnerStatus.CONFIRMED),
        // Место 2 освободилось, заменить оказалось некем.
        winner(2, 2, ContestWinnerStatus.EXPIRED),
      ],
    });

    const stats = await service.getContestStats(7);

    expect(stats.placesFilled).toBe(1);
    expect(stats.prizePlaces).toBe(2);
    expect(stats.winnersExpired).toBe(1);
  });

  it('конкурс без подтверждения: все победители CONFIRMED, места закрыты', async () => {
    const { service } = build({
      winners: [
        winner(1, 1, ContestWinnerStatus.CONFIRMED),
        winner(2, 2, ContestWinnerStatus.CONFIRMED),
      ],
    });

    const stats = await service.getContestStats(7);

    expect(stats.winnersConfirmed).toBe(2);
    expect(stats.winnersPending).toBe(0);
    expect(stats.placesFilled).toBe(2);
  });
});
