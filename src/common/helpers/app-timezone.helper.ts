/**
 * Часовой пояс приложения: в нём трактуются даты конкурсов, приходящие с
 * фронта, и в нём же считается расписание крон-задач.
 *
 * Читаем process.env напрямую, а не через ConfigService, потому что зона нужна
 * в @Cron-декораторах — они выполняются при объявлении класса, когда DI ещё
 * нет. Тот же приём уже применён в getAdminTelegramIdsFromEnv.
 */
export const DEFAULT_APP_TIME_ZONE = 'Europe/Moscow';

export function getAppTimeZone(): string {
  return process.env.APP_TIME_ZONE?.trim() || DEFAULT_APP_TIME_ZONE;
}
