import './env'; // .env.test + защита
import { DataSource } from 'typeorm';
import { initTestDb, truncateAll, closeTestDb } from './harness';
import { createUser, createContest } from './fixtures';
import { buildWinnerService } from './build-services';
import { ContestWinnerAudit } from 'src/modules/contests/entities/contest-winner-audit.entity';
import { WinnerStrategy } from 'src/common/enums/contest';

/**
 * ХАРАКТЕРИЗАЦИЯ (Фаза 3) — MANUAL-аудит назначения победителей (Q5.2).
 *
 * Бизнес-правило (🟢): мануальное назначение пишет неизменяемый след «КТО
 * (админ) назначил КАКИХ победителей и КОГДА» в contest_winner_audit. У MANUAL
 * нет алгоритмической честности — доказательство легитимности держится на этой
 * записи (защита от инсайдера и в споре). Повторное назначение — НОВАЯ строка
 * (история «кто менял» не затирается).
 *
 * Бьём в ту же высоту, что и RANDOM: реальный ContestWinnerService.
 * recordManualAssignment (его же дёргает updateContest своим рабочим путём).
 */
describe('характеризация: MANUAL-аудит назначения победителей', () => {
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

  it('назначение пишет след «кто/кого», повторное — новую запись (история)', async () => {
    const admin = await createUser(ds);
    const creator = await createUser(ds);
    const contest = await createContest(ds, creator, {
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 2,
    });
    const w1 = await createUser(ds);
    const w2 = await createUser(ds);
    const w3 = await createUser(ds);

    const service = buildWinnerService(ds);
    const auditRepo = ds.getRepository(ContestWinnerAudit);

    // Первое назначение.
    await service.recordManualAssignment(contest.id, [w1.id, w2.id], 2, admin.id);

    let audits = await auditRepo.find({
      where: { contestId: contest.id },
      order: { id: 'ASC' },
    });
    const first = audits[0];

    console.log(
      `[наблюдение] MANUAL-след #1: strategy=${first.strategy}, ` +
        `assignedBy=${first.assignedByUserId} (админ=${admin.id}), ` +
        `победители=${JSON.stringify(first.winnerUserIds)}, seed=${first.seed}`,
    );

    expect(audits.length).toBe(1);
    expect(first.strategy).toBe(WinnerStrategy.MANUAL);
    expect(first.assignedByUserId).toBe(admin.id); // «кто» зафиксирован
    expect(first.winnerUserIds).toEqual([w1.id, w2.id]); // «кого»
    expect(first.prizePlaces).toBe(2);
    // RANDOM-поля не заполняются для MANUAL:
    expect(first.seed).toBeNull();
    expect(first.algorithm).toBeNull();
    expect(first.participantUserIds).toBeNull();

    // Повторное назначение (заменили 2-го победителя) — НОВАЯ запись.
    await service.recordManualAssignment(contest.id, [w1.id, w3.id], 2, admin.id);

    audits = await auditRepo.find({
      where: { contestId: contest.id },
      order: { id: 'ASC' },
    });

    console.log(
      `[наблюдение] после повторного назначения записей=${audits.length} ` +
        `(ожидаем 2); последний набор=${JSON.stringify(audits[1].winnerUserIds)}`,
    );

    expect(audits.length).toBe(2); // история не затёрта — видно, кто и что менял
    expect(audits[1].winnerUserIds).toEqual([w1.id, w3.id]);
  });
});
