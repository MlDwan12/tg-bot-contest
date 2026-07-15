import { PartialType } from '@nestjs/mapped-types';
import { CreateContestDto } from './create-contest.dto';
import {
  IsOptional,
  IsEnum,
  IsArray,
  IsInt,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ContestStatus } from 'src/common/enums/contest';
import { Transform, Type } from 'class-transformer';

/**
 * Один ручной победитель. Ровно одно из полей (проверяет сервис):
 *  • telegramId — реальный пользователь (резолвится по TG);
 *  • username   — фиктивный ник без TG-аккаунта.
 */
export class ManualWinnerInputDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  telegramId?: number;

  @IsOptional()
  @IsString()
  username?: string;
}

/**
 * Парсит входной `winners` в массив объектов. В multipart-запросе поле
 * приходит JSON-строкой, поэтому разбираем и её. Структурную корректность
 * («либо-либо», дубли, пустой ник) проверяет сервис — единый источник правды.
 */
export function toManualWinnerArray(
  value: unknown,
): ManualWinnerInputDto[] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  let raw: unknown = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  if (!Array.isArray(raw)) {
    return undefined;
  }

  return raw.map((item) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    // Возвращаем ЭКЗЕМПЛЯР класса, а не плоский объект: при whitelist +
    // forbidNonWhitelisted class-validator берёт метаданные из класса. С плоским
    // объектом он не видит telegramId/username и роняет «property should not exist».
    const result = new ManualWinnerInputDto();

    if (
      obj.telegramId !== undefined &&
      obj.telegramId !== null &&
      obj.telegramId !== ''
    ) {
      result.telegramId = Number(obj.telegramId);
    }

    if (typeof obj.username === 'string') {
      result.username = obj.username;
    }

    return result;
  });
}

export class UpdateContestDto extends PartialType(CreateContestDto) {
  @IsOptional()
  @IsEnum(ContestStatus)
  status?: ContestStatus;

  @IsOptional()
  @Transform(({ value }) => toManualWinnerArray(value))
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualWinnerInputDto)
  winners?: ManualWinnerInputDto[];
}
