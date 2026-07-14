import './env'; // .env.test + защита
import { DataSource } from 'typeorm';
import { initTestDb, truncateAll, closeTestDb } from './harness';
import { createUser, createContest } from './fixtures';
import { buildContestRepos } from './build-services';
import { ContestsParticipateService } from 'src/modules/contests/services/contest-participate.service';

/**
 * ХАРАКТЕРИЗАЦИЯ (Фаза 0.2).
 * Бизнес-правило (🟢): повторный тап «Участвовать» возвращает ТО ЖЕ участие
 * (дружелюбный no-op), без ошибки и без второй строки в БД.
 *
 * Тут впервые собираем РЕАЛЬНЫЙ ContestsParticipateService вручную:
 * настоящие репозитории + настоящая тест-БД, фейки — только на внешний мир.
 */
describe('характеризация: идемпотентность participate() при дубле', () => {
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

  it('повторный тап возвращает то же участие: без ошибки, без второй строки', async () => {
    const user = await createUser(ds);
    const contest = await createContest(ds, user); // ACTIVE, без обязательных каналов

    const repos = buildContestRepos(ds);

    // Фейкаем ТОЛЬКО внешний мир. Репозитории и БД — настоящие.
    const fakeUserTg = { ensureUser: async () => user } as any;
    const fakeQueue = { add: async () => ({ id: 'job1' }) } as any;
    const fakeTelegram = {
      checkUserInChannels: async () => ({ passed: true, missingChannels: [] }),
    } as any;
    const fakeWinner = { getContestWinners: async () => [] } as any;
    const fakeLogger = { debug() {}, error() {}, log() {} } as any;

    const service = new ContestsParticipateService(
      repos.contest,
      repos.participation,
      fakeQueue,
      fakeUserTg,
      fakeTelegram,
      fakeWinner,
      fakeLogger,
    );

    const tgData = { telegramId: user.telegramId as string, groupId: '100' };

    const first: any = await service.participate(contest.id, tgData);
    const second: any = await service.participate(contest.id, tgData); // дубль

    const count = await repos.participation.countParticipants(contest.id);

    console.log(
      `[наблюдение] participate ×2: first.id=${first.id}, second.id=${second.id} ` +
        `(ожидаем равны); строк участия в БД=${count} (ожидаем 1)`,
    );

    expect(second.id).toBe(first.id); // вернулось то же участие, а не новое
    expect(count).toBe(1); // второй строки не создалось — дубль поглощён
  });
});
