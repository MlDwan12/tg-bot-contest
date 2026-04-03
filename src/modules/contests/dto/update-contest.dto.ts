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
    if (Array.isArray(value)) return value.map(Number);

    if (typeof value === 'string') {
      try {
        return JSON.parse(value).map(Number);
      } catch {
        return [];
      }
    }

    return [];
  })
  @IsArray()
  @IsInt({ each: true })
  winners?: number[];
}
