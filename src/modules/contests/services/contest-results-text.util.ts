/**
 * Сборка текста завершённого конкурсного поста: базовый текст (название +
 * описание, ровно как при публикации) плюс блок победителей.
 *
 * Чистая функция без зависимостей — вся возня с лимитами Telegram и escaping
 * держится здесь и покрыта юнит-тестами.
 */

/** Лимит подписи под фото. Текстовый пост допускает 4096. */
export const TELEGRAM_CAPTION_LIMIT = 1024;
export const TELEGRAM_TEXT_LIMIT = 4096;

export interface ResultsWinner {
  place: number;
  /** TG-username реального победителя (без @). */
  username?: string | null;
  firstName?: string | null;
  /** Ник фиктивного победителя, вписанный оператором (может быть с @). */
  displayUsername?: string | null;
  userId?: number | null;
}

export interface ContestResultsText {
  text: string;
  /** Сколько победителей реально попало в текст. */
  shownWinners: number;
  /**
   * true → блок победителей не поместился целиком и обрезан («…и ещё N»),
   * либо не поместился совсем (тогда shownWinners = 0 и текст остался базовым).
   * Вызывающий логирует это как повод укоротить описание конкурса.
   */
  truncated: boolean;
}

const RESULTS_HEADER = '🏆 Победители:';
const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Экранируем то, что пришло от пользователя/оператора: посты уходят с
 * parse_mode=HTML, и `<` в нике сломает разбор всего сообщения.
 * Название и описание конкурса НЕ экранируем — там HTML-разметка допустима
 * намеренно (так работает публикация сегодня).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Имя победителя для показа в канале. Приоритет: TG-username (Telegram сам
 * сделает его ссылкой на профиль) → ник фиктивного победителя → имя → id.
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

function formatWinnerLine(winner: ResultsWinner): string {
  const prefix =
    winner.place >= 1 && winner.place <= MEDALS.length
      ? MEDALS[winner.place - 1]
      : `${winner.place}.`;

  return `${prefix} ${formatWinnerName(winner)}`;
}

/**
 * Базовый текст поста — тот же формат, что при публикации и синхронизации,
 * чтобы завершение не меняло вид поста ничем, кроме блока победителей.
 */
export function buildContestBaseText(params: {
  name: string;
  description?: string | null;
}): string {
  return `${params.name}\n\n${params.description || ''}`;
}

/**
 * Базовый текст + блок победителей, гарантированно укладывающийся в limit.
 *
 * Если блок целиком не влезает, отбрасываем победителей с хвоста и дописываем
 * «…и ещё N». Если не влезает даже заголовок — возвращаем базовый текст без
 * блока: обрезать базовый текст нельзя, в нём может быть HTML-разметка, и
 * разрез посреди тега сломает пост целиком (Telegram ответит 400).
 */
export function buildContestResultsText(params: {
  name: string;
  description?: string | null;
  winners: ResultsWinner[];
  limit: number;
}): ContestResultsText {
  const base = buildContestBaseText(params);

  const winners = [...params.winners].sort((a, b) => a.place - b.place);

  if (!winners.length) {
    return { text: base, shownWinners: 0, truncated: false };
  }

  const lines = winners.map(formatWinnerLine);

  for (let shown = lines.length; shown > 0; shown--) {
    const hidden = lines.length - shown;
    const block = [
      RESULTS_HEADER,
      ...lines.slice(0, shown),
      ...(hidden > 0 ? [`…и ещё ${hidden}`] : []),
    ].join('\n');

    const text = `${base}\n\n${block}`;

    if (text.length <= params.limit) {
      return { text, shownWinners: shown, truncated: hidden > 0 };
    }
  }

  return { text: base, shownWinners: 0, truncated: true };
}
