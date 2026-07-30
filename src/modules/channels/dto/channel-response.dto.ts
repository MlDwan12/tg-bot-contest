import { ChannelPlatform, ChannelType } from 'src/common/enums/channel';
import { Channel } from '../entities';
import { toLegacyTelegramFields } from '../utils/channel-legacy.util';

/**
 * Ответ API канала. На переходный период дублирует platform/externalId
 * в legacy-полях telegramId/telegramUsername (только для platform=telegram),
 * чтобы не сломать админ-панель до её перехода на новый контракт.
 */
export class ChannelResponseDto {
  id: number;
  platform: ChannelPlatform;
  externalId?: string;
  externalUsername?: string;
  name?: string;
  isActive: boolean;
  type: ChannelType;
  createdAt: Date;

  /** @deprecated переходный период — используй externalId. */
  telegramId: number | null;
  /** @deprecated переходный период — используй externalUsername. */
  telegramUsername: string | null;

  static fromEntity(channel: Channel): ChannelResponseDto {
    const dto = new ChannelResponseDto();
    dto.id = channel.id;
    dto.platform = channel.platform;
    dto.externalId = channel.externalId;
    dto.externalUsername = channel.externalUsername;
    dto.name = channel.name;
    dto.isActive = channel.isActive;
    dto.type = channel.type;
    dto.createdAt = channel.createdAt;

    const legacy = toLegacyTelegramFields(channel);
    dto.telegramId = legacy.telegramId;
    dto.telegramUsername = legacy.telegramUsername;

    return dto;
  }
}
