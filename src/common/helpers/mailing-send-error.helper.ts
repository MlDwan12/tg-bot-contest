/**
 * Классификация ошибки отправки сообщения рассылки:
 * - blocked   — человек недоступен навсегда (бот заблокирован, аккаунт удалён);
 * - temporary — стоит повторить (429, 5xx Telegram, сетевой сбой/таймаут);
 * - error     — всё остальное, повторять бессмысленно.
 *
 * Повторяем только то, что точно временное: неизвестная ошибка, принятая за
 * временную, на большой рассылке умножит запросы (например, «Media file not
 * found» — у всех 24к получателей сразу).
 */
export type MailingSendErrorKind = 'blocked' | 'temporary' | 'error';

const BLOCKED_PATTERNS = [/bot was blocked by the user/i, /user is deactivated/i];

// Сетевые ошибки node-fetch, через который ходит telegraf.
const NETWORK_ERROR_NAMES = ['FetchError', 'AbortError'];

export function classifyMailingSendError(error: unknown): MailingSendErrorKind {
  const err = error as {
    name?: string;
    message?: string;
    response?: { error_code?: number };
  };
  const message = err?.message ?? String(error);

  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'blocked';
  }

  const code = err?.response?.error_code;
  if (code === 429 || (code !== undefined && code >= 500)) {
    return 'temporary';
  }

  if (err?.name && NETWORK_ERROR_NAMES.includes(err.name)) {
    return 'temporary';
  }

  return 'error';
}
