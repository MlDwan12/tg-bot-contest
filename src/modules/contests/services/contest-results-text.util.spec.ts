import { formatWinnerName } from './contest-results-text.util';

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
});
