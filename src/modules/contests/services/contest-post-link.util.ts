/**
 * Ссылка на опубликованный пост конкурса.
 *
 * Два формата, и разница между ними принципиальна:
 *  • публичный канал (есть username) → t.me/<username>/<id> — откроется у любого;
 *  • приватный → t.me/c/<внутренний id>/<id> — откроется ТОЛЬКО у того, кто
 *    состоит в канале. Для админа и участника это обычно так, но пришедший по
 *    репосту такую ссылку не откроет. Пустую ссылку не отдаём вовсе — лучше
 *    строки без ссылки, чем битый переход.
 */
export type ContestPostRef = {
  chatId: string | number | null;
  telegramMessageId: number | null;
  channelUsername?: string | null;
  channelTitle?: string | null;
};

export function buildContestPostLink(post: ContestPostRef): string | null {
  if (!post.telegramMessageId || post.chatId == null) return null;

  const username = post.channelUsername?.replace(/^@/, '').trim();

  if (username) {
    return `https://t.me/${username}/${post.telegramMessageId}`;
  }

  // Приватные чаты в ссылках идут без префикса -100: -1002949180383 → 2949180383.
  const internalId = String(post.chatId).replace(/^-100/, '').replace(/^-/, '');

  if (!/^\d+$/.test(internalId)) return null;

  return `https://t.me/c/${internalId}/${post.telegramMessageId}`;
}

/**
 * Ссылка на пост в КОНКРЕТНОМ чате — том, откуда участник нажал «Участвовать»
 * (groupId его участия). Победителю показываем именно её: он видел этот пост,
 * а ссылка на чужой канал, где он не состоит, только запутает.
 */
export function findPostLinkForChat(
  posts: ContestPostRef[],
  chatId: string | null | undefined,
): string | null {
  if (!chatId) return null;

  const post = posts.find((item) => String(item.chatId) === String(chatId));

  return post ? buildContestPostLink(post) : null;
}

/** Все ссылки конкурса — для администратора: он ведёт все площадки сразу. */
export function buildAllPostLinks(posts: ContestPostRef[]): string[] {
  return posts
    .map((post) => buildContestPostLink(post))
    .filter((link): link is string => link !== null);
}
