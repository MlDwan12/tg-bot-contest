import './env'; // .env.test + защита
import { DataSource } from 'typeorm';
import { initTestDb, truncateAll, closeTestDb } from './harness';
import { createUser, createContest, addParticipant } from './fixtures';
import { buildWinnerService } from './build-services';
import { WinnerStrategy } from 'src/common/enums/contest';

/**
 * ХАРАКТЕРИЗАЦИЯ (Фаза 0.2) — розыгрыш победителей.
 *
 * Дёргаем НАСТОЯЩИЙ ContestWinnerService.resolveAndSaveWinners():
 * настоящие winner-репозитории + настоящая тест-БД, без фейков (внешнего мира
 * тут нет — вся логика внутри БД).
 */
describe('характеризация: розыгрыш победителей RANDOM', () => {
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

  // Правило 1 (🟢): RANDOM выбирает победителей ИЗ участников,
  // а их количество равно числу призовых мест.
  it('RANDOM: победители выбраны из участников, число = призовым местам', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.RANDOM,
      prizePlaces: 2,
    });

    // 4 участника → 2 призовых места.
    const participants = [];
    for (let i = 0; i < 4; i++) {
      participants.push(await addParticipant(ds, contest.id));
    }
    const participantIds = new Set(participants.map((p) => p.user.id));

    const service = buildWinnerService(ds);
    await service.resolveAndSaveWinners(contest);

    const winners = await service.getContestWinners(contest.id);
    const winnerIds = winners.map((w) => w.userId);

    console.log(
      `[наблюдение] участников=${participantIds.size}, призовых мест=${contest.prizePlaces}; ` +
        `победители userId=[${winnerIds.join(', ')}], места=[${winners
          .map((w) => w.place)
          .join(', ')}]`,
    );

    // Число победителей = число призовых мест.
    expect(winners.length).toBe(contest.prizePlaces);
    // Каждый победитель — реальный участник конкурса.
    for (const id of winnerIds) {
      expect(participantIds.has(id)).toBe(true);
    }
    // Победители не дублируются и места уникальны (1..prizePlaces).
    expect(new Set(winnerIds).size).toBe(winnerIds.length);
    expect(winners.map((w) => w.place).sort()).toEqual([1, 2]);
  });

  // Правило 2 (🟢): повторный запуск НЕ перевыбирает победителей
  // (reuse-guard, фикс 05ab97a). Читатель видит стабильный набор.
  it('повторный запуск НЕ перевыбирает победителя (reuse-guard)', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.RANDOM,
      prizePlaces: 1,
    });

    // 10 участников на 1 место: если бы шёл повторный розыгрыш,
    // шанс случайно совпасть = 1/10 → тест поймал бы регресс.
    for (let i = 0; i < 10; i++) {
      await addParticipant(ds, contest.id);
    }

    const service = buildWinnerService(ds);

    await service.resolveAndSaveWinners(contest);
    const firstWinner = (await service.getContestWinners(contest.id))[0].userId;

    await service.resolveAndSaveWinners(contest); // повторный запуск
    const secondWinner = (await service.getContestWinners(contest.id))[0].userId;

    console.log(
      `[наблюдение] розыгрыш ×2 при 10 участниках на 1 место: ` +
        `1-й=${firstWinner}, 2-й=${secondWinner} (ожидаем равны — reuse-guard держит)`,
    );

    expect(secondWinner).toBe(firstWinner); // тот же победитель, не перевыбран
  });
});
