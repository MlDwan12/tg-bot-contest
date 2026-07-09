import './env'; // .env.test + защита
import { DataSource } from 'typeorm';
import { initTestDb, truncateAll, closeTestDb } from './harness';
import { createUser, createContest, addParticipant } from './fixtures';
import { buildLifecycleService } from './build-services';
import { WinnerStrategy } from 'src/shared/enums/contest';

/**
 * 🔴 ТЕСТ-МИШЕНЬ F1 — гонка при завершении конкурса (residual race).
 *
 * Бизнес-правило (ДОЛЖНО быть): завершение RANDOM-конкурса без заранее
 * выбранного победителя разыгрывает победителя РОВНО ОДИН раз, сколько бы
 * одновременных завершений ни пришло.
 *
 * Мишень (ARCHITECTURE_REVIEW.md §F1): ручной путь completeContest
 * (PATCH /:id/complete) НЕ берёт advisory lock и меняет статус неатомарно.
 * reuse-guard внутри resolveAndSaveWinners — это read-then-write БЕЗ
 * блокировки (TOCTOU). Двойной клик админа → два одновременных completeContest
 * → оба читают existingWinners=0 ДО первой записи → два независимых
 * Math.random-розыгрыша, второй replace перезаписывает первого. Шедулерный
 * lock (finishContestIdempotent) на другом пути и тут не помогает.
 *
 * ПОЧЕМУ БАРЬЕР: наивный Promise.all НЕ воспроизводит гонку надёжно —
 * планировщик Node может успеть завершить один вызов до чтения другого
 * (тогда reuse-guard срабатывает случайно → ложнозелёный). Барьер пиннит
 * тот самый worst-case порядок, который код НЕ умеет предотвращать: оба
 * завершения читают «победителей нет», и лишь потом пишут. Подменяем ТАЙМИНГ
 * чтения, а не данные (чтение реальное, call-through).
 *
 * СТАТУС: ✅ ЗАКРЫТ (Фаза 2). В completeContest добавлены атомарные ворота
 * updateStatusIfNotCompleted (CAS ACTIVE→COMPLETED): гонку выигрывает один,
 * он и разыгрывает; проигравший отсекается ДО розыгрыша (throw «уже завершён»)
 * и до winnerRead.findByContestId не доходит — барьер разжимается по таймауту.
 * Розыгрыш ровно один. Тест — регрессионный сторож: если ворота уберут,
 * снова станет красным.
 */

/**
 * Барьер на N участников с таймаут-подстраховкой. Держит всех пришедших,
 * пока не соберётся N (или не истечёт timeoutMs — чтобы не зависнуть, если
 * после фикса второй участник вообще не придёт).
 */
function makeBarrier(parties: number, timeoutMs: number) {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((res) => {
    release = res;
  });
  const timer = setTimeout(() => release(), timeoutMs);
  return async function wait(): Promise<void> {
    arrived += 1;
    if (arrived >= parties) {
      clearTimeout(timer);
      release();
    }
    await gate;
  };
}

describe('F1 (закрыт): ворота completeContest — розыгрыш ровно один раз', () => {
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

  it('двойной клик по completeContest разыгрывает победителя РОВНО один раз', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.RANDOM,
      prizePlaces: 1,
    });

    // 10 участников на 1 место: если розыгрыш случится дважды, наборы
    // победителей с высокой вероятностью разойдутся (шанс совпасть = 1/10).
    for (let i = 0; i < 10; i++) {
      await addParticipant(ds, contest.id);
    }

    // Реальный lifecycle + winner-сервис + репозитории (одни инстанции).
    const { service: lifecycle, repos, winnerService } =
      buildLifecycleService(ds);

    // Барьер форсирует worst-case порядок: оба завершения читают «победителей
    // нет» ДО того, как любой из них запишет. Подменяем только тайминг чтения.
    const barrier = makeBarrier(2, 500);
    const realFind = repos.winnerRead.findByContestId.bind(repos.winnerRead);
    jest
      .spyOn(repos.winnerRead, 'findByContestId')
      .mockImplementation(async (cid: number) => {
        const res = await realFind(cid); // реальное чтение (call-through)
        await barrier(); // держим, пока оба не прочитают пусто
        return res;
      });

    // Шпион за каждым сохранённым розыгрышем: один replace = один розыгрыш.
    const replaceSpy = jest.spyOn(repos.winnerWrite, 'replace');

    // Двойной клик: два одновременных ручных завершения одного конкурса.
    const results = await Promise.allSettled([
      lifecycle.completeContest(contest.id),
      lifecycle.completeContest(contest.id),
    ]);

    const draws = replaceSpy.mock.calls.length;
    const drawnSets = replaceSpy.mock.calls.map((call) =>
      call[1].map((row) => row.userId),
    );
    const finalWinners = (
      await winnerService.getContestWinners(contest.id)
    ).map((w) => w.userId);
    const statuses = results.map((r) => r.status);

    console.log(
      `[наблюдение] двойной клик completeContest: independent розыгрышей (replace)=${draws} ` +
        `(ДОЛЖНО быть 1); наборы победителей по розыгрышам=${JSON.stringify(
          drawnSets,
        )}; итоговые победители в БД=${JSON.stringify(finalWinners)}; ` +
        `исходы вызовов=${JSON.stringify(statuses)}`,
    );

    // Правило: одно завершение = один розыгрыш (ворота держат гонку).
    expect(draws).toBe(1);
    // Инвариант «победителей = призовым местам»: при баге тут оседало 2 строки
    // на 1 место (двойной DELETE не удалял чужую uncommitted строку).
    expect(finalWinners.length).toBe(contest.prizePlaces);
  });
});
