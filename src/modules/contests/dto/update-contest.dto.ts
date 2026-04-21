import { PartialType } from '@nestjs/mapped-types';
import { CreateContestDto } from './create-contest.dto';
import { IsOptional, IsEnum, IsArray, IsInt } from 'class-validator';
import { ContestStatus } from 'src/shared/enums/contest';
import { Transform } from 'class-transformer';

export class UpdateContestDto extends PartialType(CreateContestDto) {
  @IsOptional()
  @IsEnum(ContestStatus)
  status?: ContestStatus;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (Array.isArray(value)) {
      return value.map(Number);
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);

        if (!Array.isArray(parsed)) {
          return undefined;
        }

        return parsed.map(Number);
      } catch {
        return undefined;
      }
    }

    return undefined;
  })
  @IsArray()
  @IsInt({ each: true })
  winners?: number[];
}
