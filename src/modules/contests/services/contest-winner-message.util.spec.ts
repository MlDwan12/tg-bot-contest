import { buildWinnerNotificationText } from './contest-winner-message.util';

describe('buildWinnerNotificationText', () => {
  it('первое место получает медаль', () => {
    expect(
      buildWinnerNotificationText({
        contestName: 'Розыгрыш',
        place: 1,
        prizePlaces: 3,
      }),
    ).toBe('🥇 Поздравляем! Вы заняли 1 место в конкурсе «Розыгрыш».');
  });

  it('места с четвёртого идут без медали', () => {
    expect(
      buildWinnerNotificationText({
        contestName: 'Розыгрыш',
        place: 4,
        prizePlaces: 5,
      }),
    ).toBe('Поздравляем! Вы заняли 4 место в конкурсе «Розыгрыш».');
  });

  it('HTML в названии конкурса экранируется — иначе ломается всё сообщение', () => {
    expect(
      buildWinnerNotificationText({
        contestName: 'Приз <b>1',
        place: 2,
        prizePlaces: 3,
      }),
    ).toBe('🥈 Поздравляем! Вы заняли 2 место в конкурсе «Приз &lt;b&gt;1».');
  });

  describe('единственное призовое место', () => {
    it('не пишем «заняли 1 место» — это звучит странно, когда мест всего одно', () => {
      expect(
        buildWinnerNotificationText({
          contestName: 'Розыгрыш',
          place: 1,
          prizePlaces: 1,
        }),
      ).toBe('🥇 Поздравляем! Вы победили в конкурсе «Розыгрыш».');
    });

    it('и с дедлайном подтверждения — тоже «победили», а не «заняли место»', () => {
      const text = buildWinnerNotificationText({
        contestName: 'Розыгрыш',
        place: 1,
        prizePlaces: 1,
        confirmationDeadline: new Date('2026-07-30T12:00:00Z'),
        confirmationHours: 24,
      });

      expect(text).toContain('Вы победили в конкурсе «Розыгрыш»');
      expect(text).not.toContain('заняли');
    });
  });

  describe('срок подтверждения', () => {
    const deadline = new Date('2026-07-30T12:00:00Z');

    it('без дедлайна текст прежний — конкурс без подтверждения не меняется', () => {
      const text = buildWinnerNotificationText({
        contestName: 'Розыгрыш',
        place: 1,
        prizePlaces: 3,
        confirmationDeadline: null,
        confirmationHours: 24,
      });

      expect(text).toBe(
        '🥇 Поздравляем! Вы заняли 1 место в конкурсе «Розыгрыш».',
      );
    });

    it('с дедлайном добавляется срок и дата со смещением пояса', () => {
      const text = buildWinnerNotificationText({
        contestName: 'Розыгрыш',
        place: 1,
        prizePlaces: 3,
        confirmationDeadline: deadline,
        confirmationHours: 24,
      });

      expect(text).toContain('в течение 24 часов');
      expect(text).toContain('30.07.2026');

      // Смещение обязательно: часовой пояс победителя Bot API не отдаёт, и без
      // метки москвич с новосибирцем прочитают одно число по-разному.
      expect(text).toMatch(/GMT[+-]\d/);
      expect(text).toContain('приз перейдёт следующему участнику');
    });

    it('один час склоняется как «1 часа» (родительный после «в течение»)', () => {
      const text = buildWinnerNotificationText({
        contestName: 'Розыгрыш',
        place: 1,
        prizePlaces: 3,
        confirmationDeadline: deadline,
        confirmationHours: 1,
      });

      expect(text).toContain('в течение 1 часа');
    });

    it('21 час — тоже «часа», а 11 — «часов»', () => {
      const at = (hours: number) =>
        buildWinnerNotificationText({
          contestName: 'Розыгрыш',
          place: 1,
          prizePlaces: 3,
          confirmationDeadline: deadline,
          confirmationHours: hours,
        });

      expect(at(21)).toContain('в течение 21 часа');
      expect(at(11)).toContain('в течение 11 часов');
    });
  });
});
