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
 * ХАРАКТЕРИЗАЦИЯ (Фаза 10.3) — фиксируем ТЕКУЩЕЕ поведение ветвистого
 * MANUAL-блока `ContestsService.updateContest` ПЕРЕД выносом его в приватный
 * метод. Все правила ниже — 🟢 (закрепляем как есть). Вынос обязан сохранить 1:1.
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
      await service.updateContest(contest.id, { winners: [123] } as any);
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
        winners: [123],
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
        winners: [5, 5],
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
        winners: [5],
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
        winners: [999],
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
      { winners: [111, 222], winnerStrategy: WinnerStrategy.MANUAL } as any,
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
    expect(recordManualAssignment).toHaveBeenCalledWith(
      contest.id,
      [uA.id, uB.id],
      2,
      7,
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
});
