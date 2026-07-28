import {
  buildContestResultsText,
  formatWinnerName,
  TELEGRAM_CAPTION_LIMIT,
} from './contest-results-text.util';

describe('contest-results-text.util', () => {
  describe('formatWinnerName', () => {
    it('реальный победитель показывается как @username', () => {
      expect(formatWinnerName({ place: 1, username: 'ivan' })).toBe('@ivan');
    });

    it('username с ведущей @ не удваивает её', () => {
      expect(formatWinnerName({ place: 1, username: '@ivan' })).toBe('@ivan');
    });

    it('фиктивный победитель (без TG) показывается по displayUsername', () => {
      expect(
        formatWinnerName({ place: 1, displayUsername: '@ivan_petrov' }),
      ).toBe('@ivan_petrov');
    });

    it('без ников показывается имя', () => {
      expect(formatWinnerName({ place: 1, firstName: 'Иван' })).toBe('Иван');
    });

    it('без ников и имени — id участника', () => {
      expect(formatWinnerName({ place: 1, userId: 42 })).toBe('Участник #42');
    });

    it('username приоритетнее имени', () => {
      expect(
        formatWinnerName({ place: 1, username: 'ivan', firstName: 'Иван' }),
      ).toBe('@ivan');
    });

    it('HTML в имени экранируется — иначе ломается parse_mode=HTML', () => {
      expect(
        formatWinnerName({ place: 1, firstName: '<b>Иван</b> & Co' }),
      ).toBe('&lt;b&gt;Иван&lt;/b&gt; &amp; Co');
    });

    it('HTML в ник фиктивного победителя тоже экранируется', () => {
      expect(formatWinnerName({ place: 1, displayUsername: 'a<script>' })).toBe(
        '@a&lt;script&gt;',
      );
    });
  });

  describe('buildContestResultsText', () => {
    const base = { name: 'Розыгрыш', description: 'Приз — телефон' };

    it('без победителей текст остаётся базовым', () => {
      const result = buildContestResultsText({
        ...base,
        winners: [],
        limit: TELEGRAM_CAPTION_LIMIT,
      });

      expect(result.text).toBe('Розыгрыш\n\nПриз — телефон');
      expect(result).toMatchObject({ shownWinners: 0, truncated: false });
    });

    it('первые три места помечаются медалями, дальше — номером', () => {
      const result = buildContestResultsText({
        ...base,
        winners: [
          { place: 1, username: 'a' },
          { place: 2, username: 'b' },
          { place: 3, username: 'c' },
          { place: 4, username: 'd' },
        ],
        limit: TELEGRAM_CAPTION_LIMIT,
      });

      expect(result.text).toBe(
        'Розыгрыш\n\nПриз — телефон\n\n🏆 Победители:\n🥇 @a\n🥈 @b\n🥉 @c\n4. @d',
      );
      expect(result).toMatchObject({ shownWinners: 4, truncated: false });
    });

    it('победители сортируются по месту независимо от порядка на входе', () => {
      const result = buildContestResultsText({
        ...base,
        winners: [
          { place: 2, username: 'b' },
          { place: 1, username: 'a' },
        ],
        limit: TELEGRAM_CAPTION_LIMIT,
      });

      expect(result.text).toContain('🥇 @a\n🥈 @b');
    });

    it('пустое описание не оставляет лишних переводов строки в блоке', () => {
      const result = buildContestResultsText({
        name: 'Розыгрыш',
        description: null,
        winners: [{ place: 1, username: 'a' }],
        limit: TELEGRAM_CAPTION_LIMIT,
      });

      expect(result.text).toBe('Розыгрыш\n\n\n\n🏆 Победители:\n🥇 @a');
    });

    it('длинный список обрезается с хвоста и укладывается в лимит', () => {
      const winners = Array.from({ length: 50 }, (_, i) => ({
        place: i + 1,
        username: `user_with_quite_long_name_${i}`,
      }));

      const result = buildContestResultsText({
        ...base,
        winners,
        limit: 300,
      });

      expect(result.text.length).toBeLessThanOrEqual(300);
      expect(result.truncated).toBe(true);
      expect(result.shownWinners).toBeGreaterThan(0);
      expect(result.shownWinners).toBeLessThan(50);
      expect(result.text).toContain(`…и ещё ${50 - result.shownWinners}`);
    });

    it('если не влезает даже заголовок — базовый текст не трогаем', () => {
      const longDescription = 'x'.repeat(1000);

      const result = buildContestResultsText({
        name: 'Розыгрыш',
        description: longDescription,
        winners: [{ place: 1, username: 'a' }],
        limit: TELEGRAM_CAPTION_LIMIT,
      });

      expect(result.text).toBe(`Розыгрыш\n\n${longDescription}`);
      expect(result).toMatchObject({ shownWinners: 0, truncated: true });
    });

    it('повторный вызов даёт тот же текст — правка поста идемпотентна', () => {
      const params = {
        ...base,
        winners: [{ place: 1, username: 'a' }],
        limit: TELEGRAM_CAPTION_LIMIT,
      };

      expect(buildContestResultsText(params).text).toBe(
        buildContestResultsText(params).text,
      );
    });
  });
});
