import { Type } from 'class-transformer';
import { IsOptional, IsString, IsEnum, IsNumber } from 'class-validator';
import { ChannelPlatform, ChannelType } from 'src/common/enums/channel';

/**
 * На переходный период DTO принимает и старый Telegram-контракт
 * (telegramId/telegramUsername), и новый (platform+externalId).
 * Нормализация — в ChannelsService.resolveExternalIdentity.
 */
export class CreateChannelDto {
  /** @deprecated переходный период — используй externalId. */
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  telegramId?: number;

  /** @deprecated переходный период — используй externalUsername. */
  @IsOptional()
  @IsString()
  telegramUsername?: string;

  @IsOptional()
  @IsEnum(ChannelPlatform)
  platform?: ChannelPlatform;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsString()
  externalUsername?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(ChannelType, {})
  type?: ChannelType = ChannelType.CASINO;
}
