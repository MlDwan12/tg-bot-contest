/**
 * Сводка по конкурсу для админ-панели: качество аудитории и доставка
 * уведомлений победителям.
 */
export class ContestStatsDto {
  contestId: number;

  /** Уникальные участники, всего. */
  participantsTotal: number;

  /** Прошли перепроверку подписки (или она не проводилась). */
  participantsValid: number;

  /** Отписались после участия — в розыгрыш не шли. */
  participantsUnsubscribed: number;

  /**
   * Проводилась ли перепроверка. Пока null, participantsUnsubscribed = 0
   * означает «не проверяли», а не «никто не отписался» — без этого поля
   * ноль читался бы неверно.
   */
  subscriptionsCheckedAt: Date | null;

  winnersTotal: number;

  /** Победители, получившие личное уведомление. */
  notificationsDelivered: number;

  /**
   * Уведомление не доставлено — чаще всего победитель не запускал бота
   * (бот не может писать первым). Таким имеет смысл написать вручную.
   */
  notificationsFailed: number;
}
