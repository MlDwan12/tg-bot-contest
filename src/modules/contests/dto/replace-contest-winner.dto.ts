import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Замена ОДНОГО победителя в уже завершённом конкурсе (см.
 * ContestWinnerService#replaceCompletedContestWinner). Структурную
 * корректность («ровно одно из currentTelegramId/currentUsername»,
 * «либо random, либо newTelegramId/newUsername») проверяет сервис —
 * тот же подход, что и у ManualWinnerInputDto (update-contest.dto.ts).
 */
export class ReplaceContestWinnerDto {
  // --- кого меняем (текущий победитель) ---
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  currentTelegramId?: number;

  @IsOptional()
  @IsString()
  currentUsername?: string;

  // --- на кого меняем ---
  @IsOptional()
  @IsBoolean()
  random?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  newTelegramId?: number;

  @IsOptional()
  @IsString()
  newUsername?: string;
}
