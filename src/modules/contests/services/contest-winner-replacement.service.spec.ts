import { ContestWinnerReplacementService } from './contest-winner-replacement.service';
import { ContestWinnerStatus, WinnerStrategy } from 'src/common/enums/contest';
import { seededShuffle } from './seeded-draw.util';

const SEED = 'a'.repeat(64);
const POOL = [1, 2, 3, 4, 5];

/** Тот же порядок, что увидит сервис: та же функция, тот же seed, тот же вход. */
const ORDER = seededShuffle(POOL, SEED);

function build(
  options: {
    strategy?: WinnerStrategy;
    winners?: Array<{ userId: number | null }>;
    draw?: Record<string, any> | null;
    subscribed?: (userId: number) => boolean;
    requireConfirmation?: boolean;
  } = {},
) {
  const appended: any[] = [];
  const auditRecords: any[] = [];

  const contestRepo = {
    findByParams: async () => ({
      id: 7,
      winnerStrategy: options.strategy ?? WinnerStrategy.RANDOM,
      requireWinnerConfirmation: options.requireConfirmation ?? true,
      confirmationHours: 24,
    }),
  } as any;

  const contestWinnerRepo = {
    findByContestId: async () =>
      options.winners ?? [{ userId: ORDER[0] }, { userId: ORDER[1] }],
    append: async (row: any) => {
      appended.push(row);
      return { id: 99, ...row };
    },
  } as any;

  const syncCalls: any[] = [];
  const participationRepo = {
    syncWinnerFlagsInTransaction: async (_id: number, winners: any[]) => {
      syncCalls.push(winners);
    },
  } as any;

  const auditRepo = {
    findDrawByContestId: async () =>
      options.draw === undefined
        ? {
            seed: SEED,
            participantUserIds: POOL,
            prizePlaces: 2,
          }
        : options.draw,
    record: async (data: any) => {
      auditRecords.push(data);
    },
  } as any;

  const recheckService = {
    isUserStillSubscribed: async (_contestId: number, userId: number) =>
      options.subscribed ? options.subscribed(userId) : true,
  } as any;

  const logger = { log() {}, warn() {}, error() {}, debug() {} } as any;

  const service = new ContestWinnerReplacementService(
    contestRepo,
    contestWinnerRepo,
    participationRepo,
    auditRepo,
    recheckService,
    logger,
  );

  return { service, appended, auditRecords, syncCalls };
}

describe('ContestWinnerReplacementService.fillVacatedPlace', () => {
  it('место занимает следующий по тому же перемешиванию', async () => {
    const { service, appended } = build();

    const result = await service.fillVacatedPlace(7, 1);

    // Первые два элемента порядка — уже победители, значит замена — третий.
    expect(result).toMatchObject({ status: 'replaced', userId: ORDER[2] });
    expect(appended[0]).toMatchObject({
      contestId: 7,
      userId: ORDER[2],
      place: 1,
      status: ContestWinnerStatus.PENDING_CONFIRMATION,
    });

    // Заменивший получает ПОЛНЫЙ срок с момента назначения: он только сейчас
    // узнал о призе, остаток чужого дедлайна был бы несправедлив.
    expect(appended[0].confirmationDeadline).toBeInstanceOf(Date);
    expect(appended[0].confirmationDeadline.getTime()).toBeGreaterThan(
      Date.now() + 23 * 60 * 60 * 1000,
    );
  });

  it('отписавшийся кандидат пропускается, а его id попадает в аудит замены', async () => {
    const { service, appended, auditRecords } = build({
      subscribed: (userId) => userId !== ORDER[2],
    });

    const result = await service.fillVacatedPlace(7, 1);

    expect(result).toMatchObject({ status: 'replaced', userId: ORDER[3] });
    expect(appended[0].userId).toBe(ORDER[3]);

    // Без списка пропущенных проверяющий пересчитает shuffle, увидит на месте
    // не следующего по порядку и решит, что розыгрыш подкручен.
    expect(auditRecords[0].note).toContain(
      `пропущены (отписались): ${ORDER[2]}`,
    );
    expect(auditRecords[0].winnerUserIds).toEqual([ORDER[3]]);
  });

  it('уже побывавшие победителями не выбираются повторно', async () => {
    // Место 1 освободилось во второй раз: ORDER[2] уже был заменой и отказался.
    const { service, appended } = build({
      winners: [
        { userId: ORDER[0] },
        { userId: ORDER[1] },
        { userId: ORDER[2] },
      ],
    });

    await service.fillVacatedPlace(7, 1);

    expect(appended[0].userId).toBe(ORDER[3]);
  });

  it('после замены флаги в participants синхронизируются по живым победителям', async () => {
    const { service, syncCalls } = build({
      winners: [
        { userId: ORDER[0], place: 1, status: ContestWinnerStatus.DECLINED },
        { userId: ORDER[1], place: 2, status: ContestWinnerStatus.CONFIRMED },
      ],
    });

    await service.fillVacatedPlace(7, 1);

    // Отказавшийся флаг теряет, иначе он остался бы isWinner в CSV и мини-аппе,
    // а заменивший — без отметки.
    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0]).toEqual([{ userId: ORDER[1], place: 2 }]);
  });

  it('очередь исчерпана → no_candidates, место не закрывается', async () => {
    const { service, appended } = build({
      winners: POOL.map((userId) => ({ userId })),
    });

    const result = await service.fillVacatedPlace(7, 1);

    expect(result).toEqual({ status: 'no_candidates' });
    expect(appended).toHaveLength(0);
  });

  it('MANUAL: автозамены нет — жеребьёвки не было', async () => {
    const { service, appended } = build({ strategy: WinnerStrategy.MANUAL });

    const result = await service.fillVacatedPlace(7, 1);

    expect(result).toEqual({ status: 'not_applicable' });
    expect(appended).toHaveLength(0);
  });

  it('нет следа розыгрыша → заменить некем', async () => {
    const { service } = build({ draw: null });

    expect(await service.fillVacatedPlace(7, 1)).toEqual({
      status: 'no_candidates',
    });
  });

  it('подтверждение выключено → заменивший сразу CONFIRMED, без дедлайна', async () => {
    const { service, appended } = build({ requireConfirmation: false });

    await service.fillVacatedPlace(7, 1);

    expect(appended[0].status).toBe(ContestWinnerStatus.CONFIRMED);
    expect(appended[0].confirmationDeadline).toBeNull();
  });
});
