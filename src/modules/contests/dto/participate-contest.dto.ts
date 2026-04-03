import { IsOptional, IsString } from 'class-validator';

export class ParticipateContestDto {
  @IsString()
  telegramId: string;

  @IsString()
  groupId: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;
}
