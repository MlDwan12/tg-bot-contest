import { Transform, Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsDate,
  IsArray,
  IsNotEmpty,
  ArrayUnique,
  MaxLength,
  IsBoolean,
} from 'class-validator';
import { WinnerStrategy } from 'src/common/enums/contest';
import { CreateContest } from 'src/modules/contests/types';
import { IsFutureDate } from 'src/common/validators/is-future-date.validator';
import { BadRequestException } from '@nestjs/common';

export function toNumberArray(value: unknown): number[] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const normalize = (input: unknown[]): number[] => {
    const result: number[] = [];

    for (const item of input) {
      if (item === undefined || item === null) {
        continue;
      }

      const raw = String(item).trim();

      if (!raw) {
        continue;
      }

      if (!/^-?\d+$/.test(raw)) {
        throw new BadRequestException(
          `Некорректное значение в массиве id: "${raw}"`,
        );
      }

      const num = Number(raw);

      if (!Number.isSafeInteger(num)) {
        throw new BadRequestException(
          `Некорректное числовое значение: "${raw}"`,
        );
      }

      result.push(num);
    }

    return result;
  };

  if (Array.isArray(value)) {
    return normalize(value);
  }

  if (typeof value === 'string') {
    const s = value.trim();

    if (!s) {
      return undefined;
    }

    if (s.startsWith('[') && s.endsWith(']')) {
      try {
        const parsed = JSON.parse(s);

        if (!Array.isArray(parsed)) {
          throw new BadRequestException('Ожидался массив чисел');
        }

        return normalize(parsed);
      } catch (error) {
        if (error instanceof BadRequestException) {
          throw error;
        }

        throw new BadRequestException('Некорректный JSON-массив для списка id');
      }
    }

    return normalize(s.split(','));
  }

  const raw = String(value).trim();

  if (!/^-?\d+$/.test(raw)) {
    throw new BadRequestException(`Некорректное значение id: "${raw}"`);
  }

  const num = Number(raw);

  if (!Number.isSafeInteger(num)) {
    throw new BadRequestException(`Некорректное числовое значение: "${raw}"`);
  }

  return [num];
}

export class CreateContestDto implements Omit<CreateContest, 'creatorId'> {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsEnum(WinnerStrategy)
  winnerStrategy: WinnerStrategy;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  prizePlaces: number;

  @Type(() => Date)
  @IsDate()
  @IsFutureDate({ message: 'startDate must not be in the past' })
  startDate: Date;

  @Type(() => Date)
  @IsDate()
  @IsFutureDate({ message: 'endDate must not be in the past' })
  endDate: Date;

  // Перепроверка подписки перед розыгрышем. По умолчанию включена — выключать
  // осознанно. Строковые 'true'/'false' принимаем: форма шлётся multipart.
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return value;
  })
  @IsBoolean()
  recheckSubscriptionOnFinish?: boolean;

  // Требовать ли от победителя подтверждения приза. Выключено по умолчанию:
  // с выключенным конкурс идёт как раньше (CONFIRMED сразу, без кнопки и
  // дедлайна). Строковые 'true'/'false' — как выше, форма шлётся multipart.
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return value;
  })
  @IsBoolean()
  requireWinnerConfirmation?: boolean;

  // Срок подтверждения в часах. Учитывается только при включённом
  // requireWinnerConfirmation. Потолок в неделю — защита от опечатки вроде
  // 2400 часов, из-за которой место зависло бы на месяцы.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  confirmationHours?: number;

  // ВАЖНО:
  // если реально ищешь по telegramId, лучше переименовать поле.
  @IsOptional()
  @Transform(({ value }) => toNumberArray(value))
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  publishChannelIds?: number[];

  @IsOptional()
  @Transform(({ value }) => toNumberArray(value))
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  requiredChannelIds?: number[];

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(5000)
  postText?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  buttonText?: string;
}
