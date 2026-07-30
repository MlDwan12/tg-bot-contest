import { ChannelPlatform } from 'src/common/enums/channel';
import { Channel } from '../entities';

/**
 * Переходный период: старый Telegram-контракт API (telegramId/telegramUsername)
 * вычисляется из platform+externalId и виден только для platform=telegram.
 * Убрать вместе с переводом потребителей на platform+externalId.
 */
export function toLegacyTelegramFields(
  channel: Pick<Channel, 'platform' | 'externalId' | 'externalUsername'>,
): { telegramId: number | null; telegramUsername: string | null } {
  if (channel.platform !== ChannelPlatform.TELEGRAM) {
    return { telegramId: null, telegramUsername: null };
  }

  return {
    telegramId:
      channel.externalId !== undefined ? Number(channel.externalId) : null,
    telegramUsername: channel.externalUsername ?? null,
  };
}
