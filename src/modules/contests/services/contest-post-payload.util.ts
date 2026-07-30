/**
 * Сборка того, что уходит в канал: текст, кнопка и картинка конкурсного поста.
 *
 * Вынесено в чистую функцию, чтобы превью показывало ровно то же, что потом
 * реально опубликуется. Если собирать текст в двух местах, превью рано или
 * поздно разойдётся с публикацией — и разойдётся незаметно.
 */

export interface ContestPostPayload {
  text: string;
  buttonText: string;
  buttonUrl: string;
  /** Путь к картинке; undefined — пост будет текстовым. */
  photoUrl?: string;
}

export const DEFAULT_BUTTON_TEXT = 'Участвовать';

export function buildContestPostPayload(params: {
  contestId: number;
  /** telegramId канала: он входит в deep-link мини-аппа. */
  channelTelegramId: number | string;
  name: string;
  description?: string | null;
  buttonText?: string | null;
  imagePath?: string | null;
  miniAppUrl?: string;
}): ContestPostPayload {
  return {
    text: `${params.name}\n\n${params.description || ''}`,
    buttonText: params.buttonText?.trim() || DEFAULT_BUTTON_TEXT,
    buttonUrl: `${params.miniAppUrl}?startapp=${params.channelTelegramId}_${params.contestId}`,
    photoUrl: params.imagePath ?? undefined,
  };
}
