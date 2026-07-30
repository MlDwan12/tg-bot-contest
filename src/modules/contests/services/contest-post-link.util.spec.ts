import {
  buildAllPostLinks,
  buildContestPostLink,
  findPostLinkForChat,
} from './contest-post-link.util';

describe('ссылки на пост конкурса', () => {
  it('публичный канал → ссылка по username', () => {
    expect(
      buildContestPostLink({
        chatId: '-1002949180383',
        telegramMessageId: 126,
        channelUsername: 'GroupRandomTestPub',
      }),
    ).toBe('https://t.me/GroupRandomTestPub/126');
  });

  it('username с @ нормализуется', () => {
    expect(
      buildContestPostLink({
        chatId: '-1002949180383',
        telegramMessageId: 126,
        channelUsername: '@GroupRandomTestPub',
      }),
    ).toBe('https://t.me/GroupRandomTestPub/126');
  });

  it('приватный канал → ссылка вида t.me/c без префикса -100', () => {
    expect(
      buildContestPostLink({
        chatId: '-1002949180383',
        telegramMessageId: 126,
      }),
    ).toBe('https://t.me/c/2949180383/126');
  });

  it('пост не опубликован → ссылки нет', () => {
    // Лучше строка без ссылки, чем битый переход.
    expect(
      buildContestPostLink({ chatId: '-100294918', telegramMessageId: null }),
    ).toBeNull();
    expect(
      buildContestPostLink({ chatId: null, telegramMessageId: 5 }),
    ).toBeNull();
  });

  describe('победителю — пост того чата, где он участвовал', () => {
    const posts = [
      {
        chatId: '-1001111111111',
        telegramMessageId: 10,
        channelUsername: 'first',
      },
      {
        chatId: '-1002222222222',
        telegramMessageId: 20,
        channelUsername: 'second',
      },
    ];

    it('находит пост по groupId участия', () => {
      expect(findPostLinkForChat(posts, '-1002222222222')).toBe(
        'https://t.me/second/20',
      );
    });

    it('чат не среди публикаций → ссылки нет', () => {
      // Ссылка на чужой канал, где победитель не состоит, только запутает.
      expect(findPostLinkForChat(posts, '-1009999999999')).toBeNull();
      expect(findPostLinkForChat(posts, null)).toBeNull();
    });
  });

  it('администратору — все ссылки, неопубликованные пропускаются', () => {
    expect(
      buildAllPostLinks([
        {
          chatId: '-1001111111111',
          telegramMessageId: 10,
          channelUsername: 'a',
        },
        { chatId: '-1002222222222', telegramMessageId: null },
        { chatId: '-1003333333333', telegramMessageId: 30 },
      ]),
    ).toEqual(['https://t.me/a/10', 'https://t.me/c/3333333333/30']);
  });
});
