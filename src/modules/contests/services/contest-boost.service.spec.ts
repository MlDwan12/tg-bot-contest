import { ExecutionContext } from '@nestjs/common';
import { ContestStatus } from 'src/common/enums/contest';
import { UserRole } from 'src/common/enums/user/user-role.enum';
import { BotAdminGuard } from '../bot/bot-admin.guard';
import { buildBoostDelays, ContestBoostService } from './contest-boost.service';

const MIN = 60_000;

function makeService(contest: object | null) {
  const queue = { addBulk: jest.fn(), getDelayed: jest.fn() };
  const contestRepo = {
    findById: jest.fn().mockResolvedValue(contest),
    incrementDisplayBonus: jest.fn(),
  };
  const service = new ContestBoostService(
    contestRepo as any,
    {} as any,
    { syncParticipantsCounter: jest.fn() } as any,
    queue as any,
    { log: jest.fn() } as any,
  );
  return { service, queue, contestRepo };
}

describe('buildBoostDelays', () => {
  it('раскладывает задержки монотонно строго внутри окна', () => {
    for (let run = 0; run < 50; run++) {
      const delays = buildBoostDelays(20, 60 * MIN);
      expect(delays).toHaveLength(20);
      delays.forEach((d, i) => {
        expect(d).toBeGreaterThan(0);
        expect(d).toBeLessThan(60 * MIN);
        if (i > 0) expect(d).toBeGreaterThan(delays[i - 1]);
      });
    }
  });
});

describe('ContestBoostService.schedule', () => {
  it('обрезает окно по endDate и ставит валидные для BullMQ jobId', async () => {
    const { service, queue } = makeService({
      id: 7,
      status: ContestStatus.ACTIVE,
      endDate: new Date(Date.now() + 30 * MIN),
    });

    const minutes = await service.schedule(7, 20, 360);

    expect(minutes).toBe(30);
    const jobs = queue.addBulk.mock.calls[0][0];
    expect(jobs).toHaveLength(20);
    for (const job of jobs) {
      expect(job.opts.delay).toBeLessThanOrEqual(30 * MIN);
      expect(job.opts.attempts).toBe(1);
      // BullMQ: id с ':' обязан иметь ровно 3 сегмента, иначе addBulk падает целиком.
      expect(job.opts.jobId.split(':')).toHaveLength(3);
    }
    expect(new Set(jobs.map((j) => j.opts.jobId)).size).toBe(20);
  });

  it('не накручивает неактивный конкурс', async () => {
    const { service, queue } = makeService({
      id: 7,
      status: ContestStatus.COMPLETED,
      endDate: new Date(Date.now() + 30 * MIN),
    });

    await expect(service.schedule(7, 20, 60)).rejects.toThrow('не активен');
    expect(queue.addBulk).not.toHaveBeenCalled();
  });

  it('tick ничего не делает после завершения конкурса', async () => {
    const { service, contestRepo } = makeService({
      id: 7,
      status: ContestStatus.COMPLETED,
    });

    await service.tick(7);
    expect(contestRepo.incrementDisplayBonus).not.toHaveBeenCalled();
  });
});

describe('BotAdminGuard', () => {
  const prevAdminIds = process.env.ADMIN_IDS;
  beforeAll(() => (process.env.ADMIN_IDS = '111, 222'));
  afterAll(() => {
    if (prevAdminIds === undefined) delete process.env.ADMIN_IDS;
    else process.env.ADMIN_IDS = prevAdminIds;
  });

  const ctxFor = (fromId: number) =>
    ({
      getType: () => 'telegraf',
      getArgs: () => [{ from: { id: fromId } }, jest.fn()],
      getClass: () => Object,
      getHandler: () => () => undefined,
    }) as unknown as ExecutionContext;

  const makeGuard = (role: UserRole | null) => {
    const usersService = {
      findByTelegramId: jest.fn().mockResolvedValue(role ? { role } : null),
    };
    return {
      guard: new BotAdminGuard(usersService as any),
      usersService,
    };
  };

  it('id не из env — отказ без запроса в БД', async () => {
    const { guard, usersService } = makeGuard(UserRole.ADMIN);
    await expect(guard.canActivate(ctxFor(999))).resolves.toBe(false);
    expect(usersService.findByTelegramId).not.toHaveBeenCalled();
  });

  it('id из env, но роль USER — отказ', async () => {
    const { guard } = makeGuard(UserRole.USER);
    await expect(guard.canActivate(ctxFor(222))).resolves.toBe(false);
  });

  it('id из env и роль ADMIN — доступ', async () => {
    const { guard } = makeGuard(UserRole.ADMIN);
    await expect(guard.canActivate(ctxFor(111))).resolves.toBe(true);
  });
});
