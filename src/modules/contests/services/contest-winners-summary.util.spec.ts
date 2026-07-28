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
});
