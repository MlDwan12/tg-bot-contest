import './env'; // .env.test + защита
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { initTestDb, truncateAll, closeTestDb } from './harness';
import { createUser, createContest } from './fixtures';
import { buildContestRepos } from './build-services';
import { ContestsParticipateService } from 'src/modules/contests/services/contest-participate.service';
import { Channel } from 'src/modules/channels/entities/channel.entity';
import { ContestStatus } from 'src/common/enums/contest';
import { ChannelPlatform, ChannelType } from 'src/common/enums/channel';

/**
 * ХАРАКТЕРИЗАЦИЯ (Фаза 10.1) — фиксируем ТЕКУЩЕЕ поведение веток participate()
 * ПЕРЕД дроблением метода на приватные шаги (Q3.3). Все правила ниже — 🟢
 * (закрепляем как есть). Дробление обязано сохранить их 1:1.
 *
 * Сеть: если после рефакторинга ветка изменит поведение — соответствующий
 * тест покраснеет.
 */
describe('характеризация: ветки participate()', () => {
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

  /**
   * Собирает РЕАЛЬНЫЙ ContestsParticipateService (репозитории + тест-БД),
   * фейкая только внешний мир. Фейки можно переопределить под конкретную ветку.
   */
  function makeService(fakes: {
    ensureUser?: (...args: any[]) => any;
    checkUserInChannels?: (...args: any[]) => any;
    getContestWinners?: (...args: any[]) => any;
  }) {
    const repos = buildContestRepos(ds);

    const fakeQueue = { add: async () => ({ id: 'job' }) } as any;
    const fakeUserTg = {
      ensureUser:
        fakes.ensureUser ??
        (() => {
          throw new Error('ensureUser не застаблен для этой ветки');
        }),
    } as any;
    const fakeTelegram = {
      checkUserInChannels:
        fakes.checkUserInChannels ??
        (async () => ({ passed: true, missingChannels: [] })),
    } as any;
    const fakeWinner = {
      getContestWinners: fakes.getContestWinners ?? (async () => []),
    } as any;
    const fakeLogger = {
      debug() {},
      error() {},
      log() {},
      warn() {},
    } as any;

    const service = new ContestsParticipateService(
      repos.contest,
      repos.participation,
      fakeQueue,
      fakeUserTg,
      fakeTelegram,
      fakeWinner,
      fakeLogger,
    );

    return { service, repos };
  }

  it('🟢 ветка 1: PENDING → 400 «ещё не начался», участие не создаётся', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      status: ContestStatus.PENDING,
    });
    const { service, repos } = makeService({});

    const tgData = { telegramId: '777', groupId: '100' };

    let thrown: any;
    try {
      await service.participate(contest.id, tgData);
    } catch (e) {
      thrown = e;
    }

    const count = await repos.participation.countParticipants(contest.id);
    console.log(
      `[наблюдение] PENDING: тип ошибки=${thrown?.constructor?.name}, ` +
        `сообщение="${thrown?.message}", строк участия=${count} (ожидаем 0)`,
    );

    expect(thrown).toBeInstanceOf(BadRequestException);
    expect(count).toBe(0);
  });

  it('🟢 ветка 2: CANCELLED и DRAFT → 404 «не найден»', async () => {
    const creator = await createUser(ds);
    const cancelled = await createContest(ds, creator, {
      status: ContestStatus.CANCELLED,
    });
    const draft = await createContest(ds, creator, {
      status: ContestStatus.DRAFT,
    });
    const { service } = makeService({});
    const tgData = { telegramId: '778', groupId: '100' };

    let cancelledErr: any;
    let draftErr: any;
    try {
      await service.participate(cancelled.id, tgData);
    } catch (e) {
      cancelledErr = e;
    }
    try {
      await service.participate(draft.id, tgData);
    } catch (e) {
      draftErr = e;
    }

    console.log(
      `[наблюдение] CANCELLED→${cancelledErr?.constructor?.name}, ` +
        `DRAFT→${draftErr?.constructor?.name} (оба ожидаем NotFoundException)`,
    );

    expect(cancelledErr).toBeInstanceOf(NotFoundException);
    expect(draftErr).toBeInstanceOf(NotFoundException);
  });

  it('🟢 ветка 3: COMPLETED → возвращает победителей (маппинг), а не участие', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      status: ContestStatus.COMPLETED,
    });

    // Победителей отдаёт winner-сервис (фейк) — характеризуем ИМЕННО маппинг
    // participate(): что берётся place/userId/telegramId/username из строки.
    const fakeWinners = [
      {
        place: 1,
        userId: 42,
        user: { telegramId: 999, username: 'winner_one' },
      },
    ];
    const { service } = makeService({
      getContestWinners: async () => fakeWinners,
    });

    const result: any = await service.participate(contest.id, {
      telegramId: '779',
      groupId: '100',
    });

    console.log(`[наблюдение] COMPLETED вернул: ${JSON.stringify(result)}`);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([
      { place: 1, telegramId: 999, userId: 42, username: 'winner_one' },
    ]);
  });

  it('🔴 ветка 3b: COMPLETED + фиктивный победитель → ник в username, telegramId/userId = null', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      status: ContestStatus.COMPLETED,
    });

    // Смешанные победители: реальный (есть user) + фиктивный (user отсутствует,
    // только displayUsername). Проверяем, что фиктивный виден — ник попадает
    // в поле username, а telegramId/userId остаются null.
    const fakeWinners = [
      { place: 1, userId: 42, user: { telegramId: 999, username: 'real_one' } },
      { place: 2, userId: null, displayUsername: 'ivan_petrov', user: null },
    ];
    const { service } = makeService({
      getContestWinners: async () => fakeWinners,
    });

    const result: any = await service.participate(contest.id, {
      telegramId: '779',
      groupId: '100',
    });

    console.log(
      `[наблюдение] COMPLETED+фиктивный вернул: ${JSON.stringify(result)}`,
    );

    expect(result).toEqual([
      { place: 1, telegramId: 999, userId: 42, username: 'real_one' },
      { place: 2, telegramId: null, userId: null, username: 'ivan_petrov' },
    ]);
  });

  it('🟢 ветка 4: ACTIVE + обязательный канал, НЕ подписан → 403; участия нет', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator); // ACTIVE по умолчанию

    // Реальный канал + привязка обязательным (прод-метод setRequiredChannels).
    const channelRepo = ds.getRepository(Channel);
    const channel = await channelRepo.save(
      channelRepo.create({
        platform: ChannelPlatform.TELEGRAM,
        externalId: '555001',
        externalUsername: 'must_join',
        name: 'Must Join',
        type: ChannelType.OTHER,
        isActive: true,
      }),
    );

    const user = await createUser(ds);
    const { service, repos } = makeService({
      ensureUser: async () => user,
      // Эхо запрошенных channelIds = «не подписан НИ на один». Важно вернуть
      // ровно те значения (того же типа), что код передал из
      // contest.requiredChannels.map(c => c.telegramId) — иначе includes() в
      // проде-коде не совпадёт (telegramId из БД — bigint/строка). Так делает и
      // реальный checkUserInChannels: missingChannels ⊆ переданных channelIds.
      checkUserInChannels: async (
        _telegramId: string,
        channelIds: number[],
      ) => ({
        passed: false,
        missingChannels: channelIds,
      }),
    });
    await repos.contest.setRequiredChannels(contest.id, [channel.id]);

    const tgData = { telegramId: user.telegramId as string, groupId: '100' };

    let thrown: any;
    try {
      await service.participate(contest.id, tgData);
    } catch (e) {
      thrown = e;
    }

    const count = await repos.participation.countParticipants(contest.id);
    console.log(
      `[наблюдение] required-channel не подписан: тип=${thrown?.constructor?.name}, ` +
        `сообщение="${thrown?.message}", строк участия=${count} (ожидаем 0)`,
    );

    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect(thrown.message).toContain('must_join');
    expect(count).toBe(0);
  });
});
