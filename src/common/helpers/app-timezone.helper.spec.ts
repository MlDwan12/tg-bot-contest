import { DEFAULT_APP_TIME_ZONE, getAppTimeZone } from './app-timezone.helper';

describe('getAppTimeZone', () => {
  const original = process.env.APP_TIME_ZONE;

  afterEach(() => {
    if (original === undefined) delete process.env.APP_TIME_ZONE;
    else process.env.APP_TIME_ZONE = original;
  });

  it('без переменной окружения — Москва', () => {
    delete process.env.APP_TIME_ZONE;
    expect(getAppTimeZone()).toBe(DEFAULT_APP_TIME_ZONE);
    expect(DEFAULT_APP_TIME_ZONE).toBe('Europe/Moscow');
  });

  it('берёт значение из окружения', () => {
    process.env.APP_TIME_ZONE = 'Asia/Yekaterinburg';
    expect(getAppTimeZone()).toBe('Asia/Yekaterinburg');
  });

  it('пустая строка и пробелы не считаются заданной зоной', () => {
    process.env.APP_TIME_ZONE = '   ';
    expect(getAppTimeZone()).toBe(DEFAULT_APP_TIME_ZONE);

    process.env.APP_TIME_ZONE = '';
    expect(getAppTimeZone()).toBe(DEFAULT_APP_TIME_ZONE);
  });

  it('пробелы по краям обрезаются — иначе Intl бросит на " Europe/Moscow"', () => {
    process.env.APP_TIME_ZONE = '  Europe/Moscow  ';
    expect(getAppTimeZone()).toBe('Europe/Moscow');
  });
});
