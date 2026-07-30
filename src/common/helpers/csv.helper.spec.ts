import { escapeCsvValue, toCsvRow } from './csv.helper';

describe('csv.helper', () => {
  describe('escapeCsvValue', () => {
    it('обычное значение остаётся как есть', () => {
      expect(escapeCsvValue('ivan')).toBe('ivan');
    });

    it('null и undefined дают пустую ячейку', () => {
      expect(escapeCsvValue(null)).toBe('');
      expect(escapeCsvValue(undefined)).toBe('');
    });

    it('числа и булевы приводятся к строке', () => {
      expect(escapeCsvValue(42)).toBe('42');
      expect(escapeCsvValue(false)).toBe('false');
    });

    it('дата отдаётся в ISO — однозначно читается любым инструментом', () => {
      expect(escapeCsvValue(new Date('2026-07-28T09:04:15.000Z'))).toBe(
        '2026-07-28T09:04:15.000Z',
      );
    });

    it('значение с разделителем берётся в кавычки', () => {
      expect(escapeCsvValue('Иван; Петров')).toBe('"Иван; Петров"');
    });

    it('кавычка внутри удваивается', () => {
      expect(escapeCsvValue('ник "крутой"')).toBe('"ник ""крутой"""');
    });

    it('перенос строки не рвёт файл на две записи', () => {
      expect(escapeCsvValue('первая\nвторая')).toBe('"первая\nвторая"');
    });

    describe('CSV injection', () => {
      it('ник, начинающийся с =, не станет формулой в Excel', () => {
        expect(escapeCsvValue('=1+1')).toBe("'=1+1");
      });

      it('=HYPERLINK обезврежен', () => {
        expect(escapeCsvValue('=HYPERLINK("http://evil","click")')).toBe(
          '"\'=HYPERLINK(""http://evil"",""click"")"',
        );
      });

      it('@ в начале тоже гасится — это обычное начало ника', () => {
        expect(escapeCsvValue('@user')).toBe("'@user");
      });

      it('число целиком не экранируется — минус тут знак, а не формула', () => {
        // telegramId каналов отрицательные: апостроф лип бы к каждой строке.
        expect(escapeCsvValue('-1002949180383')).toBe('-1002949180383');
        expect(escapeCsvValue(-1002949180383)).toBe('-1002949180383');
        expect(escapeCsvValue('+7999')).toBe('+7999');
        expect(escapeCsvValue('-12.5')).toBe('-12.5');
      });

      it('но выражение, начинающееся со знака, гасится', () => {
        expect(escapeCsvValue('-1+1')).toBe("'-1+1");
        expect(escapeCsvValue('+7 (999) 000')).toBe("'+7 (999) 000");
      });

      it('те же символы в середине не трогаем', () => {
        expect(escapeCsvValue('user@mail')).toBe('user@mail');
      });
    });
  });

  describe('toCsvRow', () => {
    it('склеивает через разделитель и закрывает CRLF', () => {
      expect(toCsvRow(['a', 1, null])).toBe('a;1;\r\n');
    });

    it('экранирование применяется к каждой ячейке', () => {
      expect(toCsvRow(['ok', 'с;точкой'])).toBe('ok;"с;точкой"\r\n');
    });
  });
});
