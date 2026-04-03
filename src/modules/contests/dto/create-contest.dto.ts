import { Transform, Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  IsDate,
  IsArray,
} from 'class-validator';
import { WinnerStrategy } from 'src/shared/enums/contest';
import { CreateContest } from 'src/shared/types/contests';
import { IsFutureDate } from 'src/shared/validators/is-future-date.validator';

export function toNumberArray(value: unknown): number[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;

  // уже массив (повторяющиеся поля в multipart)
  if (Array.isArray(value))
    return value.map((v) => Number(v)).filter((n) => !Number.isNaN(n));

  // строка
  if (typeof value === 'string') {
    // JSON: "[2,3]"

    const s = value.trim();
    if (s.startsWith('[') && s.endsWith(']')) {
      try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr))
          return arr.map(Number).filter((n) => !Number.isNaN(n));
      } catch {}
    }

    // CSV: "2,3"
    return s
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((n) => !Number.isNaN(n));
  }

  // число/другое
  const n = Number(value);
  return Number.isNaN(n) ? undefined : [n];
}

export class CreateContestDto implements Omit<CreateContest, 'creatorId'> {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
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

  @IsOptional()
  @Transform(({ value }) => toNumberArray(value))
  @IsArray()
  @IsInt({ each: true })
  publishChannelIds?: number[];

  @IsOptional()
  @Transform(({ value }) => toNumberArray(value))
  @IsArray()
  @IsInt({ each: true })
  requiredChannelIds?: number[];

  @IsOptional()
  @IsString()
  postText?: string;

  @IsOptional()
  @IsString()
  buttonText?: string;
}
