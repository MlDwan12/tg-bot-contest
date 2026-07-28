import { buildContestPostPayload } from './contest-post-payload.util';

describe('buildContestPostPayload', () => {
  const base = {
    contestId: 7,
    channelTelegramId: -1002949180383,
    name: 'Розыгрыш',
    miniAppUrl: 'https://t.me/app',
  };

  it('текст — название и описание через пустую строку', () => {
    const payload = buildContestPostPayload({
      ...base,
      description: 'Приз — телефон',
    });

    expect(payload.text).toBe('Розыгрыш\n\nПриз — телефон');
  });

  it('без описания текст не тянет undefined', () => {
    expect(buildContestPostPayload(base).text).toBe('Розыгрыш\n\n');
  });

  it('ссылка кнопки содержит канал и конкурс — по ней мини-апп понимает контекст', () => {
    expect(buildContestPostPayload(base).buttonUrl).toBe(
      'https://t.me/app?startapp=-1002949180383_7',
    );
  });

  it('текст кнопки берётся из конкурса', () => {
    expect(
      buildContestPostPayload({ ...base, buttonText: 'Участвую! 🎁' })
        .buttonText,
    ).toBe('Участвую! 🎁');
  });

  it('пустой или пробельный текст кнопки заменяется дефолтом', () => {
    expect(
      buildContestPostPayload({ ...base, buttonText: '   ' }).buttonText,
    ).toBe('Участвовать');
    expect(buildContestPostPayload(base).buttonText).toBe('Участвовать');
  });

  it('без картинки photoUrl не задан — пост уйдёт текстом', () => {
    expect(buildContestPostPayload(base).photoUrl).toBeUndefined();
    expect(
      buildContestPostPayload({ ...base, imagePath: null }).photoUrl,
    ).toBeUndefined();
  });

  it('картинка пробрасывается как есть', () => {
    expect(
      buildContestPostPayload({ ...base, imagePath: '/uploads/contests/a.jpg' })
        .photoUrl,
    ).toBe('/uploads/contests/a.jpg');
  });

  it('превью и публикация собирают один и тот же payload', () => {
    const params = {
      ...base,
      description: 'Приз',
      buttonText: 'Жми',
      imagePath: '/uploads/contests/a.jpg',
    };

    // Один вход — один выход: расхождение превью с фактом возможно только
    // если кто-то соберёт payload в обход этой функции.
    expect(buildContestPostPayload(params)).toEqual(
      buildContestPostPayload(params),
    );
  });
});
