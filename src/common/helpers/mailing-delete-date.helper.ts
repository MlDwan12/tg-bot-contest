import { fromZonedTime, toZonedTime } from 'date-fns-tz';

const MOSCOW_TZ = 'Europe/Moscow';

/**
 * Момент, когда сообщение рассылки нужно считать просроченным для удаления:
 * следующий календарный день по Europe/Moscow, 13:59 — то есть до ежедневного
 * запуска MailingCleanupService.deleteExpiredMessages (14:00 МСК).
 *
 * Считается через date-fns-tz, а не Date#setHours — TZ процесса api не всегда
 * Europe/Moscow, а setHours трактует часы в локальной зоне процесса.
 */
export function getNextDayMoscowDeleteDate(from: Date = new Date()): Date {
  const zonedNow = toZonedTime(from, MOSCOW_TZ);

  const zonedTomorrow1359 = new Date(
    zonedNow.getFullYear(),
    zonedNow.getMonth(),
    zonedNow.getDate() + 1,
    13,
    59,
    0,
    0,
  );

  return fromZonedTime(zonedTomorrow1359, MOSCOW_TZ);
}
