import { IsOptional, IsString, ValidateIf } from 'class-validator';

export class ParticipateContestDto {
  /**
   * Telegram.WebApp.initData — подпись Telegram. Если есть, пользователь
   * берётся из неё (telegramId/username тела игнорируются). Пока необязательна:
   * фронт её ещё не шлёт. TODO(фронт): слать Telegram.WebApp.initData в этом
   * поле, затем на сервере REQUIRE_TELEGRAM_INIT_DATA=true.
   */
  @IsOptional()
  @IsString()
  initData?: string;

  // С initData telegramId берётся из подписи — в теле не нужен
  @ValidateIf((o: ParticipateContestDto) => !o.initData)
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
