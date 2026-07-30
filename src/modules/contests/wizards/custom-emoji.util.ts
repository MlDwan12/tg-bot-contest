import { MessageEntity } from '@telegraf/types';
import { escapeHtml } from '../services/contest-results-text.util';

export type CustomEmojiEntity = MessageEntity.CustomEmojiMessageEntity;

/**
 * Анимированные (Premium) эмодзи — обычный unicode-символ в тексте плюс
 * entity с id стикера. Entities мы не храним в БД (в контексте конкурса это
 * означало бы тащить Telegram-разметку в `name`/`description`, а значит и в
 * CSV/MAX; для рассылки — то же самое для текста сообщения), поэтому анимация
 * сохраняется только в диалоге с ботом: карточка и превью. Реально
 * отправленное сообщение увидит обычный fallback-символ.
 */
export function renderTextWithCustomEmoji(
  text: string,
  entities?: CustomEmojiEntity[],
): string {
  if (!entities?.length) return escapeHtml(text);

  const sorted = [...entities].sort((a, b) => a.offset - b.offset);
  let result = '';
  let cursor = 0;

  for (const entity of sorted) {
    if (entity.offset < cursor) continue; // перекрывающиеся entities — пропускаем на всякий случай
    if (entity.offset > cursor) {
      result += escapeHtml(text.slice(cursor, entity.offset));
    }
    const chunk = text.slice(entity.offset, entity.offset + entity.length);
    result += `<tg-emoji emoji-id="${entity.custom_emoji_id}">${escapeHtml(chunk)}</tg-emoji>`;
    cursor = entity.offset + entity.length;
  }

  if (cursor < text.length) {
    result += escapeHtml(text.slice(cursor));
  }

  return result;
}

export function extractCustomEmojiEntities(
  entities?: MessageEntity[],
): CustomEmojiEntity[] | undefined {
  const custom = entities?.filter(
    (e): e is CustomEmojiEntity => e.type === 'custom_emoji',
  );
  return custom?.length ? custom : undefined;
}
