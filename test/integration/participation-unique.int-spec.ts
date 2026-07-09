import './env'; // .env.test + защита
import { DataSource } from 'typeorm';
import { initTestDb, truncateAll, closeTestDb } from './harness';
import { createUser, createContest } from './fixtures';
import { ContestParticipation } from 'src/modules/contests/entities/contest-participation.entity';
import { ContestParticipationWriteRepository } from 'src/modules/contests/repositories/contest-participate-write.repository';

/**
 * ХАРАКТЕРИЗАЦИЯ (Фаза 0.2).
 * Бизнес-правило (подтверждено): один пользователь может участвовать в конкретном
 * конкурсе ТОЛЬКО ОДИН РАЗ. Классификация ревью: 🟢 «сделано правильно» — закрепляем.
 *
 * Проверяем реальный продовый класс ContestParticipationWriteRepository против
 * реального уникального индекса (contestId, userId) в настоящем Postgres.
 * На этом поведении держится идемпотентность participate() (перехват ошибки 23505).
 */
describe('характеризация: уникальность участия (contestId, userId)', () => {
  let ds: DataSource;
  let repo: ContestParticipationWriteRepository;

  beforeAll(async () => {
    ds = await initTestDb();
    // «Ручная сборка»: реальный репозиторий + реальное подключение, без NestJS DI.
    repo = new ContestParticipationWriteRepository(
      ds.getRepository(ContestParticipation),
      ds,
    );
  });

  afterAll(async () => {
    await closeTestDb(ds);
  });

  beforeEach(async () => {
    await truncateAll(ds);
  });

  it('первое участие создаётся успешно', async () => {
    const user = await createUser(ds);
    const contest = await createContest(ds, user);

    const p = await repo.createParticipation({
      contestId: contest.id,
      userId: user.id,
      groupId: '123',
    });

    console.log(
      `[наблюдение] создано участие: id=${p.id}, contestId=${p.contestId}, userId=${p.userId}`,
    );

    expect(p.id).toBeDefined();
    expect(p.contestId).toBe(contest.id);
    expect(p.userId).toBe(user.id);
  });

  it('повторное участие того же юзера в том же конкурсе → ошибка 23505', async () => {
    const user = await createUser(ds);
    const contest = await createContest(ds, user);

    await repo.createParticipation({
      contestId: contest.id,
      userId: user.id,
      groupId: '123',
    });

    // Ловим реальную ошибку, чтобы и напечатать её, и проверить.
    let caught: any;
    try {
      await repo.createParticipation({
        contestId: contest.id,
        userId: user.id,
        groupId: '456', // другая группа не должна давать второе участие
      });
    } catch (e) {
      caught = e;
    }

    // Наблюдение: печатаем, что реально вернул Postgres.
    console.log(
      `[наблюдение] дубль отклонён базой: code=${caught?.code}, ` +
        `constraint=${caught?.constraint ?? caught?.driverError?.constraint}, ` +
        `detail=${caught?.detail ?? caught?.driverError?.detail}`,
    );

    expect(caught).toBeDefined();
    // Ровно этот `code === '23505'` на ВЕРХНЕМ уровне ловит продовый participate().
    // Если тут упадёт — значит продовый перехват дублей сломан (важная находка).
    expect(caught.code).toBe('23505');
  });

  it('тот же юзер в ДРУГОМ конкурсе — участие разрешено', async () => {
    const user = await createUser(ds);
    const c1 = await createContest(ds, user);
    const c2 = await createContest(ds, user);

    const p1 = await repo.createParticipation({
      contestId: c1.id,
      userId: user.id,
      groupId: '1',
    });
    const p2 = await repo.createParticipation({
      contestId: c2.id,
      userId: user.id,
      groupId: '1',
    });

    console.log(
      `[наблюдение] два участия в разных конкурсах: ids=[${p1.id}, ${p2.id}], ` +
        `contestIds=[${c1.id}, ${c2.id}]`,
    );

    expect(p2.id).toBeDefined();
  });
});
