import { createHmac } from 'crypto';
import { verifyTelegramInitData } from './telegram-init-data.helper';

const BOT_TOKEN = '123456:TEST-token';
const NOW = 1_790_000_000_000;

/** initData так, как её подписывает Telegram. */
function sign(fields: Record<string, string>, token = BOT_TOKEN): string {
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const fields = (authDate = NOW / 1000) => ({
  auth_date: String(authDate),
  query_id: 'AAE',
  user: JSON.stringify({ id: 42, username: 'ivan', first_name: 'Иван' }),
});

describe('verifyTelegramInitData', () => {
  it('верная подпись — пользователь из initData', () => {
    expect(
      verifyTelegramInitData(sign(fields()), BOT_TOKEN, { now: NOW }),
    ).toEqual({
      id: 42,
      username: 'ivan',
      first_name: 'Иван',
    });
  });

  it('подменён пользователь при той же подписи — отказ', () => {
    const signed = new URLSearchParams(sign(fields()));
    signed.set('user', JSON.stringify({ id: 99 }));
    expect(
      verifyTelegramInitData(signed.toString(), BOT_TOKEN, { now: NOW }),
    ).toBeNull();
  });

  it('подписано другим ботом — отказ', () => {
    expect(
      verifyTelegramInitData(sign(fields(), '999:other'), BOT_TOKEN, {
        now: NOW,
      }),
    ).toBeNull();
  });

  it('старше суток — отказ', () => {
    const old = sign(fields(NOW / 1000 - 25 * 60 * 60));
    expect(verifyTelegramInitData(old, BOT_TOKEN, { now: NOW })).toBeNull();
  });

  it('мусор вместо initData — отказ, без исключений', () => {
    expect(verifyTelegramInitData('hash=zz&user=1', BOT_TOKEN)).toBeNull();
    expect(verifyTelegramInitData('', BOT_TOKEN)).toBeNull();
  });
});
