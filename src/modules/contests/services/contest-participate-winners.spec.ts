import { ContestsParticipateService } from './contest-participate.service';
import { ContestStatus, ContestWinnerStatus } from 'src/common/enums/contest';

/**
 * Завершённый конкурс отдаёт участникам победителей. После автодобора на одном
 * месте лежит несколько строк, и наружу должна уходить только актуальная.
 */
function build(winners: any[]) {
  const contestRepo = {
    findByParams: async () => ({ id: 7, status: ContestStatus.COMPLETED }),
  } as any;

  const service = new ContestsParticipateService(
    contestRepo,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { getContestWinners: async () => winners } as any,
    { log() {}, warn() {}, error() {}, debug() {} } as any,
  );

  return service;
}

describe('participate: победители завершённого конкурса', () => {
  it('отказавшийся не показывается участникам, заменивший — показывается', async () => {
    const service = build([
      {
        place: 1,
        userId: 2,
        displayUsername: null,
        status: ContestWinnerStatus.DECLINED,
        user: { telegramId: '750482759', username: 'MlDwan' },
      },
      {
        place: 1,
        userId: 5,
        displayUsername: null,
        status: ContestWinnerStatus.CONFIRMED,
        user: { telegramId: '6717368676', username: 'emMorigan' },
      },
    ]);

    const result = await service.participate(7, {
      telegramId: '1',
      groupId: 'g1',
    });

    // Иначе в мини-аппе на одном месте видны два победителя, и один из них
    // приз уже не получит.
    // Подтверждённый отдаётся в ПРЕЖНЕМ формате — без status и дедлайна.
    // Конкурсы без подтверждения так и остаются на старом контракте.
    expect(result).toEqual([
      { place: 1, telegramId: '6717368676', userId: 5, username: 'emMorigan' },
    ]);
  });

  it('ждущему решения отдаётся статус и дедлайн — замена не станет сюрпризом', async () => {
    const deadline = new Date('2026-07-29T12:00:00Z');
    const service = build([
      {
        place: 1,
        userId: 5,
        displayUsername: null,
        status: ContestWinnerStatus.PENDING_CONFIRMATION,
        confirmationDeadline: deadline,
        user: { telegramId: '6717368676', username: 'emMorigan' },
      },
    ]);

    const result = (await service.participate(7, {
      telegramId: '1',
      groupId: 'g1',
    })) as any[];

    // Имя показываем сразу, но рядом — до какого момента идёт подтверждение.
    // Без этого смена победителя выглядела бы как «поменяли втихую».
    expect(result[0].username).toBe('emMorigan');
    expect(result[0].status).toBe(ContestWinnerStatus.PENDING_CONFIRMATION);
    expect(result[0].confirmationDeadline).toEqual(deadline);
  });

  it('строка без статуса (старые данные) остаётся в выдаче', async () => {
    const service = build([
      {
        place: 1,
        userId: 5,
        displayUsername: null,
        status: ContestWinnerStatus.PENDING_CONFIRMATION,
        user: { telegramId: '6717368676', username: 'emMorigan' },
      },
    ]);

    const result = (await service.participate(7, {
      telegramId: '1',
      groupId: 'g1',
    })) as any[];

    expect(result).toHaveLength(1);
  });

  it('просроченный без замены не показывается вовсе', async () => {
    const service = build([
      {
        place: 1,
        userId: 2,
        displayUsername: null,
        status: ContestWinnerStatus.EXPIRED,
        user: { telegramId: '750482759', username: 'MlDwan' },
      },
    ]);

    const result = (await service.participate(7, {
      telegramId: '1',
      groupId: 'g1',
    })) as any[];

    // Место осталось незакрытым — показывать «победителя», который приза не
    // получит, хуже, чем не показать никого.
    expect(result).toEqual([]);
  });
});
