import { buildWinnersSummaryText } from './contest-winners-summary.util';

describe('buildWinnersSummaryText', () => {
  const base = { contestId: 12, contestName: 'Розыгрыш' };

  it('всё доставлено — без блоков про проблемы', () => {
    const text = buildWinnersSummaryText({
      ...base,
      winners: [
        { place: 1, username: 'a' },
        { place: 2, username: 'b' },
      ],
      deliveredCount: 2,
      undelivered: [],
      skipped: [],
    });

    expect(text).toBe(
      '✅ Конкурс «Розыгрыш» (ID: 12) завершён.\n\n' +
        '🏆 Победители:\n1. @a\n2. @b\n\n' +
        'Уведомлений доставлено: 2 из 2.',
    );
  });

  it('недоставленные перечислены отдельно от тех, кому писать некуда', () => {
    const text = buildWinnersSummaryText({
      ...base,
      winners: [
        { place: 1, username: 'a' },
        { place: 2, username: 'b' },
        { place: 3, displayUsername: 'masha' },
      ],
      deliveredCount: 1,
      undelivered: [{ place: 2, username: 'b' }],
      skipped: [{ place: 3, displayUsername: 'masha' }],
    });

    expect(text).toContain('Уведомлений доставлено: 1 из 3.');
    expect(text).toContain('⚠️ Не доставлено');
    expect(text).toContain('2. @b');
    expect(text).toContain('ℹ️ Без Telegram-аккаунта');
    expect(text).toContain('3. @masha');
  });

  it('конкурс без победителей', () => {
    const text = buildWinnersSummaryText({
      ...base,
      winners: [],
      deliveredCount: 0,
      undelivered: [],
      skipped: [],
    });

    expect(text).toContain('Победителей нет');
    expect(text).not.toContain('Уведомлений доставлено');
  });

  it('длинный список сворачивается', () => {
    const winners = Array.from({ length: 25 }, (_, i) => ({
      place: i + 1,
      username: `u${i}`,
    }));

    const text = buildWinnersSummaryText({
      ...base,
      winners,
      deliveredCount: 25,
      undelivered: [],
      skipped: [],
    });

    expect(text).toContain('…и ещё 5');
    expect(text).not.toContain('21. @u20');
  });

  it('HTML в названии конкурса экранируется', () => {
    const text = buildWinnersSummaryText({
      ...base,
      contestName: 'Приз <b>',
      winners: [],
      deliveredCount: 0,
      undelivered: [],
      skipped: [],
    });

    expect(text).toContain('«Приз &lt;b&gt;»');
  });

  describe('предварительная и итоговая сводка', () => {
    const base = {
      contestId: 7,
      contestName: 'Тест',
      winners: [
        {
          place: 1,
          userId: 2,
          username: 'winner',
          firstName: null,
          displayUsername: null,
        },
      ],
      deliveredCount: 1,
      undelivered: [],
      skipped: [],
    };

    it('есть ждущие решения → список помечен предварительным', () => {
      const text = buildWinnersSummaryText({
        ...base,
        pendingCount: 1,
        pendingDeadline: new Date('2026-07-30T12:00:00Z'),
      });

      // Без пометки админ примет за итог список, который сменится после отказа,
      // и пойдёт связываться не с тем человеком.
      expect(text).toContain('идёт подтверждение призов');
      expect(text).toContain('Список предварительный');
      expect(text).toContain('30.07.2026');
      expect(text).toMatch(/GMT[+-]\d/);
    });

    it('решений больше не ждём → обычная итоговая сводка', () => {
      const text = buildWinnersSummaryText({ ...base, pendingCount: 0 });

      expect(text).toContain('завершён.');
      expect(text).not.toContain('предварительный');
    });

    it('конкурс без подтверждения → сводка как раньше', () => {
      const text = buildWinnersSummaryText(base);

      expect(text).toContain('завершён.');
      expect(text).not.toContain('предварительный');
    });
  });
});
