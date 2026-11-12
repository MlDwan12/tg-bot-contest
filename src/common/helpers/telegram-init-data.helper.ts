import { createHmac, timingSafeEqual } from 'crypto';

export type TelegramInitDataUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

// initData живёт, пока открыт мини-апп; сутки — с запасом на долгую сессию
const DEFAULT_MAX_AGE_SEC = 24 * 60 * 60;

/**
 * Проверка подписи Telegram Mini App (Telegram.WebApp.initData):
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * secret = HMAC_SHA256(key="WebAppData", data=botToken)
 * hash   = HMAC_SHA256(key=secret, data=отсортированные "key=value" через \n, без hash)
 *
 * Возвращает пользователя только при верной подписи и свежем auth_date —
 * иначе null. Подделать без токена бота нельзя.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  { maxAgeSec = DEFAULT_MAX_AGE_SEC, now = Date.now() } = {},
): TelegramInitDataUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret)
    .update(dataCheckString)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || now / 1000 - authDate > maxAgeSec) return null;

  try {
    const user = JSON.parse(params.get('user') ?? '') as TelegramInitDataUser;
    return typeof user?.id === 'number' ? user : null;
  } catch {
    return null;
  }
}
