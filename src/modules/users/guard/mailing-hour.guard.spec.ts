import { BadRequestException } from '@nestjs/common';
import { AfterMailingHourGuard } from './mailing-hour.guard';

/** Гварду контекст не нужен — он смотрит только на часы. */
const anyContext = {} as never;

describe('AfterMailingHourGuard', () => {
  const guard = new AfterMailingHourGuard();
  const originalTz = process.env.APP_TIME_ZONE;

  afterEach(() => {
    jest.useRealTimers();
    if (originalTz === undefined) delete process.env.APP_TIME_ZONE;
    else process.env.APP_TIME_ZONE = originalTz;
  });

  /** Фиксируем момент UTC, чтобы час зависел только от зоны. */
  function freezeUtc(iso: string) {
    jest.useFakeTimers().setSystemTime(new Date(iso));
  }

  it('после 16:00 по зоне приложения — пропускает', () => {
    delete process.env.APP_TIME_ZONE; // Europe/Moscow по умолчанию
    freezeUtc('2026-07-28T13:30:00Z'); // 16:30 МСК

    expect(guard.canActivate(anyContext)).toBe(true);
  });

  it('до 16:00 — отказ', () => {
    delete process.env.APP_TIME_ZONE;
    freezeUtc('2026-07-28T12:30:00Z'); // 15:30 МСК

    expect(() => guard.canActivate(anyContext)).toThrow(BadRequestException);
  });

  it('ровно 16:00 — уже можно', () => {
    delete process.env.APP_TIME_ZONE;
    freezeUtc('2026-07-28T13:00:00Z');

    expect(guard.canActivate(anyContext)).toBe(true);
  });

  it('час считается по APP_TIME_ZONE, а не по зоне сервера', () => {
    // Тот же момент: в Екатеринбурге 17:30 (можно), в Москве 15:30 (нельзя).
    freezeUtc('2026-07-28T12:30:00Z');

    process.env.APP_TIME_ZONE = 'Asia/Yekaterinburg';
    expect(guard.canActivate(anyContext)).toBe(true);

    process.env.APP_TIME_ZONE = 'Europe/Moscow';
    expect(() => guard.canActivate(anyContext)).toThrow(BadRequestException);
  });

  it('в тексте ошибки — зона, а не «МСК»', () => {
    process.env.APP_TIME_ZONE = 'Asia/Yekaterinburg';
    freezeUtc('2026-07-28T06:00:00Z'); // 11:00 в Екатеринбурге

    expect(() => guard.canActivate(anyContext)).toThrow(
      'Рассылку можно запускать только после 16:00 (Asia/Yekaterinburg)',
    );
  });
});
