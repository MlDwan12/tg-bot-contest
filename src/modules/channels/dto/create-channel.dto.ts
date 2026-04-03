import { Type } from 'class-transformer';
import { IsOptional, IsString, IsEnum, IsNumber } from 'class-validator';
import { ChannelType } from 'src/shared/enums/channel';
import { CreateChannel } from 'src/shared/types/channel';

export class CreateChannelDto implements Omit<
  CreateChannel,
  'id' | 'isActive' | 'createdAt'
> {
  @IsNumber()
  @Type(() => Number)
  telegramId: number;

  @IsOptional()
  @IsString()
  telegramUsername?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(ChannelType, {})
  type?: ChannelType = ChannelType.CASINO;
}
