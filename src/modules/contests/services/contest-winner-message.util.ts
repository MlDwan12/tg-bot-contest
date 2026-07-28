import { escapeHtml } from './contest-results-text.util';

/**
 * Текст личного уведомления победителя.
 *
 * Название конкурса здесь экранируется, хотя в посте канала — нет. В посте
 * название и описание сами по себе являются контентом оператора, и разметка в
 * них намеренно допустима. Здесь же название подставляется в НАШ шаблон: не
 * закрытый оператором тег сломал бы всё сообщение целиком (Telegram ответит
 * 400, и уведомление не уйдёт ни одному победителю).
 */
export function buildWinnerNotificationText(params: {
  contestName: string;
  place: number;
}): string {
  const medals = ['🥇', '🥈', '🥉'];
  const medal =
    params.place >= 1 && params.place <= medals.length
      ? `${medals[params.place - 1]} `
      : '';

  return (
    `${medal}Поздравляем! Вы заняли ${params.place} место ` +
    `в конкурсе «${escapeHtml(params.contestName)}».`
  );
}
