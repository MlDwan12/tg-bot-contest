import { ContestSubscriptionRecheckService } from './contest-subscription-recheck.service';
import { ParticipationSubscriptionStatus } from 'src/common/enums/contest';

type MarkCall = {
  updates: Array<{
    participationIds: number[];
    status: ParticipationSubscriptionStatus;
  }>;
  checkedAt: Date;
};

function build(options: {
  contest?: Record<string, unknown> | null;
  participants?: Array<{ id: number; user?: { telegramId?: string } | null }>;
  check?: (telegramId: string) => Promise<{ passed: boolean }>;
}) {
  const markCalls: MarkCall[] = [];
  const updateCalls: Array<Record<string, unknown>> = [];

  const contestRepo = {
    findByParams: async () =>
      options.contest === undefined
        ? {
            id: 1,
            recheckSubscriptionOnFinish: true,
            subscriptionsCheckedAt: null,
            requiredChannels: [{ telegramId: 100 }],
          }
        : options.contest,
    update: async (_id: number, data: Record<string, unknown>) => {
      updateCalls.push(data);
    },
  } as any;

  const participationRepo = {
    findManyByContestId: async () => options.participants ?? [],
    markSubscriptionStatuses: async (
      updates: MarkCall['updates'],
      checkedAt: Date,
    ) => {
      markCalls.push({ updates, checkedAt });
    },
  } as any;

  const telegramService = {
    checkUserInChannels: async (telegramId: string) =>
      options.check
        ? options.check(telegramId)
        : { passed: true, missingChannels: [] },
  } as any;

  const logger = { log() {}, warn() {}, error() {}, debug() {} } as any;

  const service = new ContestSubscriptionRecheckService(
    contestRepo,
    participationRepo,
    telegramService,
    logger,
  );

  return { service, markCalls, updateCalls };
}

/** Достаёт id участий, помеченных указанным статусом в последнем вызове. */
function idsWithStatus(
  call: MarkCall,
  status: ParticipationSubscriptionStatus,
): number[] {
  return (
    call.updates.find((update) => update.status === status)?.participationIds ??
    []
  );
}

describe('ContestSubscriptionRecheckService', () => {
  describe('needsRecheck', () => {
    const { service } = build({});

    it('перепроверка включена и ещё не проводилась → нужна', () => {
      expect(
        service.needsRecheck({
          recheckSubscriptionOnFinish: true,
          subscriptionsCheckedAt: null,
        }),
      ).toBe(true);
    });

    it('перепроверка выключена → не нужна', () => {
      expect(
        service.needsRecheck({
          recheckSubscriptionOnFinish: false,
          subscriptionsCheckedAt: null,
        }),
      ).toBe(false);
    });

    it('уже проводилась → повторно не гоняем', () => {
      expect(
        service.needsRecheck({
          recheckSubscriptionOnFinish: true,
          subscriptionsCheckedAt: new Date(),
        }),
      ).toBe(false);
    });
  });

  describe('recheckContestSubscriptions', () => {
    it('отписавшийся помечается UNSUBSCRIBED, подписанный остаётся VALID', async () => {
      const { service, markCalls } = build({
        participants: [
          { id: 10, user: { telegramId: '1' } },
          { id: 20, user: { telegramId: '2' } },
        ],
        check: async (telegramId) => ({ passed: telegramId === '1' }),
      });

      const result = await service.recheckContestSubscriptions(1);

      expect(result).toEqual({ skipped: false, checked: 2, unsubscribed: 1 });
      expect(
        idsWithStatus(markCalls[0], ParticipationSubscriptionStatus.VALID),
      ).toEqual([10]);
      expect(
        idsWithStatus(
          markCalls[0],
          ParticipationSubscriptionStatus.UNSUBSCRIBED,
        ),
      ).toEqual([20]);
    });

    it('сбой запроса не считается отпиской — участник остаётся в розыгрыше', async () => {
      const { service, markCalls } = build({
        participants: [{ id: 10, user: { telegramId: '1' } }],
        check: async () => {
          throw new Error('network');
        },
      });

      const result = await service.recheckContestSubscriptions(1);

      expect(result.unsubscribed).toBe(0);
      expect(
        idsWithStatus(markCalls[0], ParticipationSubscriptionStatus.VALID),
      ).toEqual([10]);
    });

    it('участник без telegramId остаётся VALID — отписку доказать нечем', async () => {
      const { service, markCalls } = build({
        participants: [{ id: 10, user: null }],
        check: async () => {
          throw new Error('не должен вызываться');
        },
      });

      await service.recheckContestSubscriptions(1);

      expect(
        idsWithStatus(markCalls[0], ParticipationSubscriptionStatus.VALID),
      ).toEqual([10]);
    });

    it('нет обязательных каналов → проверять нечего, но отметка ставится', async () => {
      const { service, markCalls, updateCalls } = build({
        contest: {
          id: 1,
          recheckSubscriptionOnFinish: true,
          subscriptionsCheckedAt: null,
          requiredChannels: [],
        },
      });

      const result = await service.recheckContestSubscriptions(1);

      expect(result.skipped).toBe(true);
      expect(markCalls).toHaveLength(0);
      // Без отметки finishContestIdempotent снова поставил бы джоб проверки,
      // и конкурс зациклился бы, так и не завершившись.
      expect(updateCalls[0]).toHaveProperty('subscriptionsCheckedAt');
    });

    it('конкурс не найден → ничего не пишем', async () => {
      const { service, markCalls, updateCalls } = build({ contest: null });

      const result = await service.recheckContestSubscriptions(1);

      expect(result.skipped).toBe(true);
      expect(markCalls).toHaveLength(0);
      expect(updateCalls).toHaveLength(0);
    });

    it('после успешной проверки конкурс помечается проверенным', async () => {
      const { service, updateCalls } = build({
        participants: [{ id: 10, user: { telegramId: '1' } }],
      });

      await service.recheckContestSubscriptions(1);

      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].subscriptionsCheckedAt).toBeInstanceOf(Date);
    });
  });
});
