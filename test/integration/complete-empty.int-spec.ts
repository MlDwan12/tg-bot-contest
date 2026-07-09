import './env'; // .env.test + защита
import { DataSource } from 'typeorm';
import { initTestDb, truncateAll, closeTestDb } from './harness';
import { createUser, createContest } from './fixtures';
import { buildLifecycleService } from './build-services';
import { ContestStatus, WinnerStrategy } from 'src/shared/enums/contest';

/**
 * ХАРАКТЕРИЗАЦИЯ (Фаза 2) — завершение ПУСТОГО конкурса.
 *
 * Бизнес-правило (🟢): ручное completeContest конкурса без участников проходит
 * успешно — статус COMPLETED, победителей 0, розыгрыш не запускается.
 * «Нет победителей» — валидный исход, не ошибка. Согласовано с автозавершением
 * (finishContestIdempotent пропускает розыгрыш при hasParticipants=false).
 *
 * Это закрепляет ПОВЕДЕНИЕ, введённое вместе с воротами F1: раньше пустой
 * конкурс тут падал с 400 «нет участников» и застревал в ACTIVE.
 */
describe('характеризация: завершение пустого конкурса (0 участников)', () => {
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

  it('пустой конкурс завершается: COMPLETED, 0 победителей, без розыгрыша', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.RANDOM,
      prizePlaces: 1,
    });
    // Участников намеренно НЕ добавляем.

    const { service: lifecycle, repos } = buildLifecycleService(ds);

    // Розыгрыша быть не должно — шпион это докажет.
    const replaceSpy = jest.spyOn(repos.winnerWrite, 'replace');

    const result = await lifecycle.completeContest(contest.id);

    const winners = await repos.winnerRead.findByContestId(contest.id);

    console.log(
      `[наблюдение] пустой конкурс завершён: статус=${result.status} ` +
        `(ожидаем COMPLETED); победителей=${winners.length} (ожидаем 0); ` +
        `розыгрышей(replace)=${replaceSpy.mock.calls.length} (ожидаем 0)`,
    );

    expect(result.status).toBe(ContestStatus.COMPLETED); // конкурс закрыт
    expect(winners.length).toBe(0); // победителей нет — и это ок
    expect(replaceSpy).not.toHaveBeenCalled(); // розыгрыш не запускался
  });
});
