import {
  buildContestResultsPost,
  maskUsername,
} from './contest-results.helper';

describe('maskUsername', () => {
  it('первый символ + звёздочки + последние два', () => {
    expect(maskUsername('KnuzVladimir')).toBe('K*********ir');
    expect(maskUsername('@kelnadzar')).toBe('k******ar');
  });

  it('короткие и пустые', () => {
    expect(maskUsername('ab')).toBe('a**');
    expect(maskUsername('abc')).toBe('abc');
    expect(maskUsername(null)).toBeNull();
    expect(maskUsername('')).toBeNull();
  });

  it('идемпотентна — мини-апп цензурит повторно и получает то же', () => {
    for (const name of ['KnuzVladimir', 'ab', 'monopollyyyyy']) {
      const once = maskUsername(name);
      expect(maskUsername(once)).toBe(once);
    }
  });
});

describe('buildContestResultsPost', () => {
  const winners = [
    { place: 1, username: 'KnuzVladimir' },
    { place: 2, username: null },
    { place: 3, username: '<b>x' },
  ];

  it('список по местам, без ника — прочерк, HTML экранирован', () => {
    const text = buildContestResultsPost(winners, { useCustomEmoji: false });
    expect(text).toContain('🎉 <b>Результаты розыгрыша:</b>');
    expect(text).toContain('\n1. @K*********ir');
    expect(text).toContain('\n2. —');
    expect(text).toContain('\n3. @&lt;*&gt;x');
    expect(text).not.toContain('tg-emoji');
  });

  it('с кастомными эмодзи — тег tg-emoji с запасным эмодзи', () => {
    expect(
      buildContestResultsPost(winners, { useCustomEmoji: true }),
    ).toContain('<tg-emoji emoji-id="5436040291507247633">🎉</tg-emoji>');
  });

  it('длинный список обрезается с «…и ещё N»', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      place: i + 1,
      username: `user_number_${i}`,
    }));
    const text = buildContestResultsPost(many, { useCustomEmoji: true });
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toMatch(/…и ещё \d+$/);
  });

  it('своя шапка вместо стандартной, список после неё', () => {
    const text = buildContestResultsPost(winners, {
      useCustomEmoji: true,
      headerText: '  <b>Итоги!</b> Спасибо всем  ',
    });
    expect(
      text.startsWith('<b>Итоги!</b> Спасибо всем\n\n1. @K*********ir'),
    ).toBe(true);
    expect(text).not.toContain('Результаты розыгрыша');
  });

  it('пустая шапка — стандартная', () => {
    expect(
      buildContestResultsPost(winners, {
        useCustomEmoji: false,
        headerText: '   ',
      }),
    ).toContain('Результаты розыгрыша');
  });

  it('подпись к фото режется по 1024, а не по 4096', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      place: i + 1,
      username: `user_number_${i}`,
    }));
    const text = buildContestResultsPost(many, {
      useCustomEmoji: false,
      withPhoto: true,
    });
    expect(text.length).toBeLessThanOrEqual(1000);
    expect(text).toMatch(/…и ещё \d+$/);
  });
});
