/**
 * Форматирование победителей для сообщений бота: имя одного победителя и
 * приведение строк из БД к виду, понятному форматтерам.
 *
 * Пост канала при завершении конкурса эти функции НЕ использует — там меняется
 * только текст кнопки на «Конкурс завершён», текст поста остаётся прежним.
 * Потребители — личное уведомление победителю и сводка администраторам.
 */

export interface ResultsWinner {
  place: number;
  /** TG-username реального победителя (без @). */
  username?: string | null;
  firstName?: string | null;
  /** Ник фиктивного победителя, вписанный оператором (может быть с @). */
  displayUsername?: string | null;
  userId?: number | null;
}

/**
 * Экранируем то, что пришло от пользователя/оператора: сообщения уходят с
 * parse_mode=HTML, и `<` в нике сломает разбор всего сообщения.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Имя победителя для показа. Приоритет: TG-username (Telegram сам сделает его
 * ссылкой на профиль) → ник фиктивного победителя → имя → id.
 */
export function formatWinnerName(winner: ResultsWinner): string {
  if (winner.username) {
    return `@${escapeHtml(winner.username.replace(/^@/, ''))}`;
  }

  if (winner.displayUsername) {
    return `@${escapeHtml(winner.displayUsername.replace(/^@/, ''))}`;
  }

  if (winner.firstName) {
    return escapeHtml(winner.firstName);
  }

  return winner.userId != null ? `Участник #${winner.userId}` : 'Участник';
}

/**
 * Строки победителей из БД → вход форматтеров. Фиктивный победитель (ник,
 * вписанный оператором без TG-аккаунта) не имеет user: его имя лежит в
 * displayUsername.
 */
export function toResultsWinners(
  winners: Array<{
    place: number;
    userId: number | null;
    displayUsername: string | null;
    user?: { username?: string; firstName?: string } | null;
  }>,
): ResultsWinner[] {
  return winners.map((winner) => ({
    place: winner.place,
    username: winner.user?.username,
    firstName: winner.user?.firstName,
    displayUsername: winner.displayUsername,
    userId: winner.userId,
  }));
}
