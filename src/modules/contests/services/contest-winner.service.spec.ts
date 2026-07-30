import { ContestWinnerService } from './contest-winner.service';
import { ContestWinnerStatus, WinnerStrategy } from 'src/common/enums/contest';

type ReplaceCall = {
  contestId: number;
  rows: Array<{
    contestId: number;
    userId: number;
    place: number;
    status?: ContestWinnerStatus;
    confirmationDeadline?: Date | null;
  }>;
};

function build(options: { participantIds?: number[] } = {}) {
  const replaceCalls: ReplaceCall[] = [];

  const contestWinnerRepo = {
    // Пусто — значит розыгрыш ещё не проводился и reuse-guard не сработает.
    findByContestId: async () => [],
    replace: async (contestId: number, rows: ReplaceCall['rows']) => {
      replaceCalls.push({ contestId, rows });
    },
  } as any;

  const contestParticipationRepo = {
    findEligibleByContestId: async () =>
      (options.participantIds ?? [10, 20, 30]).map((id) => ({
        id,
        user: { id },
      })),
    syncWinnerFlagsInTransaction: async () => {},
  } as any;

  const auditRepo = { record: async () => {} } as any;

  const service = new ContestWinnerService(
    contestWinnerRepo,
    contestParticipationRepo,
    auditRepo,
  );

  return { service, replaceCalls };
}

describe('ContestWinnerService: статусы подтверждения при розыгрыше', () => {
  it('подтверждение выключено → строки без статуса и дедлайна (как до Ш10)', async () => {
    const { service, replaceCalls } = build();

    await service.resolveAndSaveWinners({
      id: 7,
      prizePlaces: 2,
      winnerStrategy: WinnerStrategy.RANDOM,
      requireWinnerConfirmation: false,
      confirmationHours: 24,
    });

    const rows = replaceCalls[0].rows;
    expect(rows).toHaveLength(2);

    // Поля не заполняем вовсе — БД проставит DEFAULT 'confirmed' и NULL.
    // Именно это оставляет прежние конкурсы работать в точности как раньше.
    for (const row of rows) {
      expect(row.status).toBeUndefined();
      expect(row.confirmationDeadline).toBeUndefined();
    }
    expect(rows.map((row) => row.place)).toEqual([1, 2]);
  });

  it('подтверждение включено → PENDING_CONFIRMATION и дедлайн у каждого', async () => {
    const before = Date.now();
    const { service, replaceCalls } = build();

    await service.resolveAndSaveWinners({
      id: 7,
      prizePlaces: 2,
      winnerStrategy: WinnerStrategy.RANDOM,
      requireWinnerConfirmation: true,
      confirmationHours: 3,
    });

    const rows = replaceCalls[0].rows;
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row.status).toBe(ContestWinnerStatus.PENDING_CONFIRMATION);

      // Дедлайн отсчитывается от момента сохранения, а не от endDate: финиш
      // может задержаться (grace-период, перепроверка подписок), и отсчёт от
      // endDate съел бы у победителя часть срока.
      const deadline = row.confirmationDeadline as Date;
      expect(deadline.getTime()).toBeGreaterThanOrEqual(
        before + 3 * 60 * 60 * 1000,
      );
      expect(deadline.getTime()).toBeLessThanOrEqual(
        Date.now() + 3 * 60 * 60 * 1000,
      );
    }
  });

  it('срок не задан → сутки по умолчанию', async () => {
    const before = Date.now();
    const { service, replaceCalls } = build();

    await service.resolveAndSaveWinners({
      id: 7,
      prizePlaces: 1,
      winnerStrategy: WinnerStrategy.RANDOM,
      requireWinnerConfirmation: true,
    });

    const deadline = replaceCalls[0].rows[0].confirmationDeadline as Date;
    expect(deadline.getTime()).toBeGreaterThanOrEqual(
      before + 24 * 60 * 60 * 1000,
    );
  });

  it('вызов без полей Ш10 не падает — старый контракт розыгрыша сохранён', async () => {
    const { service, replaceCalls } = build();

    await service.resolveAndSaveWinners({
      id: 7,
      prizePlaces: 1,
      winnerStrategy: WinnerStrategy.RANDOM,
    });

    expect(replaceCalls[0].rows[0].status).toBeUndefined();
  });
});
