import './env'; // .env.test + защита
import { DataSource } from 'typeorm';
import { initTestDb, truncateAll, closeTestDb } from './harness';
import { createUser, createContest, addParticipant } from './fixtures';
import { buildWinnerService } from './build-services';
import { ContestWinnerAudit } from 'src/modules/contests/entities/contest-winner-audit.entity';
import {
  DRAW_ALGORITHM,
  seededShuffle,
} from 'src/modules/contests/services/seeded-draw.util';
import { WinnerStrategy } from 'src/shared/enums/contest';

/**
 * ХАРАКТЕРИЗАЦИЯ (Фаза 3) — provably-fair след розыгрыша RANDOM.
 *
 * Бизнес-правило (🟢): реальный розыгрыш RANDOM пишет неизменяемый след в
 * contest_winner_audit (seed + algorithm + канонический пул участников), из
 * которого ЛЮБОЙ независимо пересчитывает тех же победителей. Это доказывает,
 * что розыгрыш не подкручен (защита при споре на дорогой приз).
 */
describe('характеризация: provably-fair след розыгрыша (RANDOM)', () => {
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

  it('розыгрыш пишет seed+пул, по которым победители пересчитываются один-в-один', async () => {
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.RANDOM,
      prizePlaces: 2,
    });
    for (let i = 0; i < 5; i++) {
      await addParticipant(ds, contest.id);
    }

    const service = buildWinnerService(ds);
    await service.resolveAndSaveWinners(contest);

    // Читаем след напрямую из БД.
    const audits = await ds.getRepository(ContestWinnerAudit).find({
      where: { contestId: contest.id },
    });
    const audit = audits[0];

    // Фактически сохранённые победители (источник истины).
    const savedWinners = (await service.getContestWinners(contest.id)).map(
      (w) => w.userId,
    );

    // НЕЗАВИСИМЫЙ ПЕРЕСЧЁТ: тот же seed + тот же пул → те же победители.
    const recomputed = seededShuffle(
      audit.participantUserIds,
      audit.seed as string,
    ).slice(0, contest.prizePlaces);

    const sortedPool = [...audit.participantUserIds].sort((a, b) => a - b);

    console.log(
      `[наблюдение] след: strategy=${audit.strategy}, algorithm=${audit.algorithm}, ` +
        `seed=${(audit.seed as string).slice(0, 12)}…; пул=${JSON.stringify(
          audit.participantUserIds,
        )}; победители(след)=${JSON.stringify(audit.winnerUserIds)}; ` +
        `пересчёт=${JSON.stringify(recomputed)}; в БД=${JSON.stringify(savedWinners)}`,
    );

    // Ровно один след на розыгрыш.
    expect(audits.length).toBe(1);
    expect(audit.strategy).toBe(WinnerStrategy.RANDOM);
    expect(audit.algorithm).toBe(DRAW_ALGORITHM);
    expect(audit.seed).toBeTruthy();

    // Пул в следе — канонический (отсортирован по userId).
    expect(audit.participantUserIds).toEqual(sortedPool);

    // Доказуемость: пересчёт из seed воспроизводит записанных победителей…
    expect(recomputed).toEqual(audit.winnerUserIds);
    // …и они совпадают с реально сохранёнными в БД.
    expect(audit.winnerUserIds).toEqual(savedWinners);
    // Победители — подмножество пула, число = призовым местам.
    expect(audit.winnerUserIds.length).toBe(contest.prizePlaces);
    for (const id of audit.winnerUserIds) {
      expect(audit.participantUserIds).toContain(id);
    }
  });
});
