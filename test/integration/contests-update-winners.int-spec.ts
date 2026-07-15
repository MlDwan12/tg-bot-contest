import './env'; // .env.test + защита
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { initTestDb, truncateAll, closeTestDb } from './harness';
import { createUser, createContest } from './fixtures';
import { buildContestRepos } from './build-services';
import { ContestsService } from 'src/modules/contests/services/contests.service';
import { ContestWinner } from 'src/modules/contests/entities/contest-winner.entity';
import { ContestStatus, WinnerStrategy } from 'src/common/enums/contest';

/**
 * MANUAL-победители `ContestsService.updateContest`.
 *
 * Тесты 1–7 (🟢) — характеризация прежнего поведения, адаптированная под новый
 * формат входа `winners` (объекты `{ telegramId } | { username }` вместо чисел).
 * Тесты 8–13 (🔴→🟢) — новое поведение: фиктивные победители (ник без TG),
 * смешанный список, валидация «либо-либо»/дублей/пустого ника.
 *
 * Сеть: собираем РЕАЛЬНЫЙ ContestsService (настоящий repos.contest + тест-БД),
 * фейкая только коллабораторов, не относящихся к назначению победителей.
 */
describe('характеризация: updateContest — MANUAL-победители', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await initTestDb();
  });

  afterAll(async () => {
    await closeTestDb(ds);
  });

  beforeEach(async () => {
    await truncateAll(ds);
  });

  function makeService(fakes: {
    findByTelegramId?: (...args: any[]) => any;
  }) {
    const repos = buildContestRepos(ds);

    const fakeLogger = {
      log() {},
      error() {},
      debug() {},
      warn() {},
    } as any;
    const fakeAdmin = {} as any;
    const fakeChannel = { getChannelsByParameters: async () => [] } as any;
    const fakeJobs = { rescheduleContest: async () => undefined } as any;
    const fakePublication = {
      syncPublishedPosts: async () => undefined,
      recreatePendingPublications: async () => undefined,
      validateBotPermissionsForPublishChannels: async () => undefined,
    } as any;
    const fakeUsers = {
      findByTelegramId: fakes.findByTelegramId ?? (async () => null),
    } as any;
    const recordManualAssignment = jest.fn(async () => undefined);
    const fakeWinnerService = { recordManualAssignment } as any;

    const service = new ContestsService(
      repos.contest,
      fakeAdmin,
      fakeLogger,
      fakeChannel,
      fakeJobs,
      fakePublication,
      fakeUsers,
      fakeWinnerService,
    );

    return { service, repos, recordManualAssignment };
  }

  it('🟢 1: winners заданы, но стратегия НЕ manual → 400', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator); // ACTIVE, RANDOM
    const { service, repos } = makeService({});

    let err: any;
    try {
      await service.updateContest(contest.id, {
        winners: [{ telegramId: 123 }],
      } as any);
    } catch (e) {
      err = e;
    }

    const winners = await repos.winner.findByContestId(contest.id);
    console.log(
      `[наблюдение] winners+не-manual: ${err?.constructor?.name} "${err?.message}", строк победителей=${winners.length}`,
    );

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('отличной от manual');
    expect(winners.length).toBe(0);
  });

  it('🟢 2: MANUAL + конкурс ещё PENDING → 400 «до старта»', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      status: ContestStatus.PENDING,
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 1,
    });
    const { service } = makeService({});

    let err: any;
    try {
      await service.updateContest(contest.id, {
        winners: [{ telegramId: 123 }],
        winnerStrategy: WinnerStrategy.MANUAL,
      } as any);
    } catch (e) {
      err = e;
    }

    console.log(
      `[наблюдение] MANUAL+PENDING: ${err?.constructor?.name} "${err?.message}"`,
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('до старта');
  });

  it('🟢 3: MANUAL + дубликаты в списке → 400', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 2,
    });
    const { service } = makeService({});

    let err: any;
    try {
      await service.updateContest(contest.id, {
        winners: [{ telegramId: 5 }, { telegramId: 5 }],
        winnerStrategy: WinnerStrategy.MANUAL,
      } as any);
    } catch (e) {
      err = e;
    }

    console.log(
      `[наблюдение] MANUAL+дубли: ${err?.constructor?.name} "${err?.message}"`,
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('дубликаты');
  });

  it('🟢 4: MANUAL + число победителей ≠ призовым местам → 400', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 2,
    });
    const { service } = makeService({});

    let err: any;
    try {
      await service.updateContest(contest.id, {
        winners: [{ telegramId: 5 }],
        winnerStrategy: WinnerStrategy.MANUAL,
      } as any);
    } catch (e) {
      err = e;
    }

    console.log(
      `[наблюдение] MANUAL+кол-во≠места: ${err?.constructor?.name} "${err?.message}"`,
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('соответствовать');
  });

  it('🟢 5: MANUAL + telegramId победителя не найден → 404', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 1,
    });
    // findByTelegramId по умолчанию возвращает null → «не найден»
    const { service } = makeService({});

    let err: any;
    try {
      await service.updateContest(contest.id, {
        winners: [{ telegramId: 999 }],
        winnerStrategy: WinnerStrategy.MANUAL,
      } as any);
    } catch (e) {
      err = e;
    }

    console.log(
      `[наблюдение] MANUAL+не найден: ${err?.constructor?.name} "${err?.message}"`,
    );
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).toContain('999');
  });

  it('🟢 6: MANUAL + валидные победители → записаны (места 1..n) + аудит', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 2,
    });
    const uA = await createUser(ds);
    const uB = await createUser(ds);

    // dto.winners — telegramId (числа); findByTelegramId маппит их на юзеров БД.
    const { service, repos, recordManualAssignment } = makeService({
      findByTelegramId: async (tid: string) =>
        tid === '111' ? uA : tid === '222' ? uB : null,
    });

    await service.updateContest(
      contest.id,
      {
        winners: [{ telegramId: 111 }, { telegramId: 222 }],
        winnerStrategy: WinnerStrategy.MANUAL,
      } as any,
      undefined,
      7, // actorUserId — проверяем проброс в аудит
    );

    const winners = await repos.winner.findByContestId(contest.id);
    console.log(
      `[наблюдение] MANUAL валидно: строк=${winners.length}, ` +
        `[userId:place]=${winners.map((w) => `${w.userId}:${w.place}`).join(',')}, ` +
        `аудит вызван=${recordManualAssignment.mock.calls.length} раз, аргументы=${JSON.stringify(recordManualAssignment.mock.calls[0])}`,
    );

    expect(winners.map((w) => ({ userId: w.userId, place: w.place }))).toEqual([
      { userId: uA.id, place: 1 },
      { userId: uB.id, place: 2 },
    ]);
    // 5-й аргумент — фиктивные ники (пусто: оба победителя реальные).
    expect(recordManualAssignment).toHaveBeenCalledWith(
      contest.id,
      [uA.id, uB.id],
      2,
      7,
      [],
    );
  });

  it('🟢 7: смена стратегии MANUAL→RANDOM очищает победителей', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 1,
    });
    // Существующий победитель до апдейта.
    const winnerUser = await createUser(ds);
    await ds.getRepository(ContestWinner).save(
      ds.getRepository(ContestWinner).create({
        contestId: contest.id,
        userId: winnerUser.id,
        place: 1,
      }),
    );

    const { service, repos } = makeService({});
    await service.updateContest(contest.id, {
      winnerStrategy: WinnerStrategy.RANDOM,
    } as any);

    const winners = await repos.winner.findByContestId(contest.id);
    console.log(
      `[наблюдение] MANUAL→RANDOM: строк победителей после=${winners.length} (ожидаем 0)`,
    );
    expect(winners.length).toBe(0);
  });

  it('🔴 8: MANUAL + фиктивный победитель (ник без TG) → строка userId=null + displayUsername', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 1,
    });
    // findByTelegramId по умолчанию null — но фиктивных мы и не ищем.
    const { service, repos } = makeService({});

    await service.updateContest(contest.id, {
      winners: [{ username: '@ivan_petrov' }],
      winnerStrategy: WinnerStrategy.MANUAL,
    } as any);

    const winners = await repos.winner.findByContestId(contest.id);
    console.log(
      `[наблюдение] фиктивный: строк=${winners.length}, ` +
        `userId=${winners[0]?.userId}, displayUsername="${winners[0]?.displayUsername}", place=${winners[0]?.place}`,
    );

    expect(winners.length).toBe(1);
    expect(winners[0].userId).toBeNull();
    expect(winners[0].displayUsername).toBe('ivan_petrov'); // @ снят
    expect(winners[0].place).toBe(1);
  });

  it('🔴 9: MANUAL + смешанный список (реальный + фиктивный) → порядок мест + аудит', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 2,
    });
    const uA = await createUser(ds);
    const { service, repos, recordManualAssignment } = makeService({
      findByTelegramId: async (tid: string) => (tid === '111' ? uA : null),
    });

    await service.updateContest(
      contest.id,
      {
        winners: [{ telegramId: 111 }, { username: 'masha' }],
        winnerStrategy: WinnerStrategy.MANUAL,
      } as any,
      undefined,
      7,
    );

    const winners = await repos.winner.findByContestId(contest.id);
    console.log(
      `[наблюдение] смешанный: ` +
        winners
          .map(
            (w) =>
              `место${w.place}[userId=${w.userId},nick=${w.displayUsername}]`,
          )
          .join(' ') +
        `, аудит=${JSON.stringify(recordManualAssignment.mock.calls[0])}`,
    );

    expect(
      winners.map((w) => ({
        userId: w.userId,
        displayUsername: w.displayUsername,
        place: w.place,
      })),
    ).toEqual([
      { userId: uA.id, displayUsername: null, place: 1 },
      { userId: null, displayUsername: 'masha', place: 2 },
    ]);
    // Реальный → winnerUserIds; фиктивный ник → 5-й аргумент.
    expect(recordManualAssignment).toHaveBeenCalledWith(
      contest.id,
      [uA.id],
      2,
      7,
      ['masha'],
    );
  });

  it('🔴 10: MANUAL + дубли ников (разный регистр) → 400', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 2,
    });
    const { service } = makeService({});

    let err: any;
    try {
      await service.updateContest(contest.id, {
        winners: [{ username: 'Ivan' }, { username: 'ivan' }],
        winnerStrategy: WinnerStrategy.MANUAL,
      } as any);
    } catch (e) {
      err = e;
    }

    console.log(
      `[наблюдение] дубли ников: ${err?.constructor?.name} "${err?.message}"`,
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('дубликаты');
  });

  it('🔴 11: MANUAL + у победителя оба поля (telegramId и ник) → 400', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 1,
    });
    const { service } = makeService({});

    let err: any;
    try {
      await service.updateContest(contest.id, {
        winners: [{ telegramId: 5, username: 'ivan' }],
        winnerStrategy: WinnerStrategy.MANUAL,
      } as any);
    } catch (e) {
      err = e;
    }

    console.log(
      `[наблюдение] оба поля: ${err?.constructor?.name} "${err?.message}"`,
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('либо');
  });

  it('🔴 12: MANUAL + у победителя нет ни telegramId, ни ника → 400', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 1,
    });
    const { service } = makeService({});

    let err: any;
    try {
      await service.updateContest(contest.id, {
        winners: [{}],
        winnerStrategy: WinnerStrategy.MANUAL,
      } as any);
    } catch (e) {
      err = e;
    }

    console.log(
      `[наблюдение] пустой элемент: ${err?.constructor?.name} "${err?.message}"`,
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('ни telegramId, ни ник');
  });

  it('🔴 13: MANUAL + ник из одного «@» (пустой после нормализации) → 400', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 1,
    });
    const { service } = makeService({});

    let err: any;
    try {
      await service.updateContest(contest.id, {
        winners: [{ username: '@' }],
        winnerStrategy: WinnerStrategy.MANUAL,
      } as any);
    } catch (e) {
      err = e;
    }

    console.log(
      `[наблюдение] пустой ник: ${err?.constructor?.name} "${err?.message}"`,
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('пустым');
  });

  it('🔴 14: фиктивный победитель виден в GET-выдаче (findByIdWithRelations) — ник в user.username, telegramId=null', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 1,
    });
    const { service, repos } = makeService({});

    // Записываем фиктивного через рабочий путь updateContest.
    await service.updateContest(contest.id, {
      winners: [{ username: '@ivan_petrov' }],
      winnerStrategy: WinnerStrategy.MANUAL,
    } as any);

    // Читаем тем же путём, что и GET /contests/:id.
    const detail: any = await repos.contest.findByIdWithRelations(contest.id);
    console.log(
      `[наблюдение] GET фиктивный: ${JSON.stringify(detail.winners)}`,
    );

    expect(detail.winners).toEqual([
      {
        id: expect.any(Number),
        userId: null,
        place: 1,
        user: { id: null, telegramId: null, username: 'ivan_petrov' },
      },
    ]);
  });
});
