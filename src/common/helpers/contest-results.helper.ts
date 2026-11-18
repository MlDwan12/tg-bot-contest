/**
 * Итоги конкурса: цензура ников и текст поста с победителями для канала.
 */

/**
 * Ник → первый символ, звёздочки, последние два: KnuzVladimir → K*********ir.
 * Короче 3 символов → a**. Правило как в мини-аппе, и оно идемпотентно:
 * мини-апп цензурит уже зацензуренный ник ещё раз и получает то же самое.
 */
export function maskUsername(
  username: string | null | undefined,
): string | null {
  const name = username?.replace(/^@/, '');
  if (!name) return null;
  if (name.length < 3) return `${name[0]}**`;
  return `${name[0]}${'*'.repeat(name.length - 3)}${name.slice(-2)}`;
}

// Анимированные эмодзи работают, только если у владельца бота Telegram Premium.
// fallback — обычный эмодзи для клиентов без поддержки и для повтора без них.
export const RESULTS_EMOJI = {
  confetti: { id: '5436040291507247633', fallback: '🎉' },
  cup: { id: '5409008750893734809', fallback: '🏆' },
} as const;

// Лимиты Telegram по видимому тексту: сообщение 4096, подпись к фото 1024.
// Считаем по сырому HTML (он всегда длиннее видимого текста) — с запасом.
const MAX_POST_LENGTH = 4000;
const MAX_CAPTION_LENGTH = 1000;

// Шапка админа (без списка): без картинки до 3000, с картинкой до 700 —
// остаток под список победителей (~15 строк гарантированно).
export const RESULTS_TEXT_MAX = 3000;
export const RESULTS_TEXT_MAX_WITH_IMAGE = 700;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Текст поста с итогами. headerText — шапка админа (HTML, как есть);
 * без неё — стандартная с эмодзи. Список победителей дописывается всегда.
 * withPhoto — текст уйдёт подписью к фото (лимит 1024).
 */
export function buildContestResultsPost(
  winners: Array<{ place: number; username: string | null }>,
  opts: {
    useCustomEmoji: boolean;
    headerText?: string | null;
    withPhoto?: boolean;
  },
): string {
  const emoji = (e: { id: string; fallback: string }) =>
    opts.useCustomEmoji
      ? `<tg-emoji emoji-id="${e.id}">${e.fallback}</tg-emoji>`
      : e.fallback;
  const max = opts.withPhoto ? MAX_CAPTION_LENGTH : MAX_POST_LENGTH;

  let text = opts.headerText?.trim()
    ? `${opts.headerText.trim()}\n`
    : `${emoji(RESULTS_EMOJI.confetti)} <b>Результаты розыгрыша:</b>\n\n` +
      `${emoji(RESULTS_EMOJI.cup)} <b>Победители:</b>`;

  for (let i = 0; i < winners.length; i++) {
    const masked = maskUsername(winners[i].username);
    const line = `\n${winners[i].place}. ${masked ? `@${escapeHtml(masked)}` : '—'}`;
    const rest = winners.length - i;
    // Не влезает с запасом под хвост «…и ещё N» — обрезаем.
    if (text.length + line.length + 20 > max) {
      return `${text}\n…и ещё ${rest}`;
    }
    text += line;
  }

  return text;
}
