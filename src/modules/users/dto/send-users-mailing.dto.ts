// import { Type } from 'class-transformer';
// import {
//   IsEnum,
//   IsInt,
//   IsNotEmpty,
//   IsOptional,
//   IsString,
//   IsUrl,
//   ValidateIf,
// } from 'class-validator';
// import { UserMailingType } from 'src/shared/enums/user/user-mailing-type.enum';

// export class SendUsersMailingDto {
//   @IsEnum(UserMailingType)
//   type: UserMailingType;

//   @IsString()
//   @IsNotEmpty()
//   text: string;

//   @ValidateIf((o) => o.type === UserMailingType.USER)
//   @Type(() => Number)
//   @IsInt()
//   userId?: number;

//   @ValidateIf((o) => o.type === UserMailingType.GROUP)
//   @IsString()
//   @IsNotEmpty()
//   groupId?: string;

//   @ValidateIf((o) => o.buttonUrl !== undefined || o.contestId !== undefined)
//   @IsString()
//   @IsNotEmpty()
//   buttonText?: string;

//   @IsOptional()
//   @Type(() => Number)
//   @IsInt()
//   contestId?: number;

//   @ValidateIf((o) => o.contestId === undefined && o.buttonText !== undefined)
//   @IsUrl(
//     {
//       require_tld: false,
//     },
//     { message: 'buttonUrl must be a valid URL' },
//   )
//   @IsNotEmpty()
//   buttonUrl?: string;
// }

import { Type } from 'class-transformer';
import {
  IsEnum,
  ValidateIf,
  IsString,
  IsNotEmpty,
  IsInt,
  IsOptional,
  IsUrl,
} from 'class-validator';
import { UserMailingType } from 'src/shared/enums/user/user-mailing-type.enum';

export class SendUsersMailingDto {
  @IsEnum(UserMailingType)
  type: UserMailingType;

  // text обязателен, только если НЕ передан contestId
  @ValidateIf((o) => o.contestId === undefined)
  @IsString()
  @IsNotEmpty()
  text?: string;

  // для USER userId обязателен
  @ValidateIf((o) => o.type === UserMailingType.USER)
  @Type(() => Number)
  @IsInt()
  userId?: number;

  // для GROUP groupId обязателен
  @ValidateIf((o) => o.type === UserMailingType.GROUP)
  @IsString()
  @IsNotEmpty()
  groupId?: string;

  // contestId сам по себе опционален
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  contestId?: number;

  // buttonText:
  // - не обязателен, если есть contestId
  // - обязателен, если передан buttonUrl
  @ValidateIf((o) => o.contestId === undefined && o.buttonUrl !== undefined)
  @IsString()
  @IsNotEmpty()
  buttonText?: string;

  // buttonUrl:
  // - не обязателен, если есть contestId
  // - обязателен, если передан buttonText
  @ValidateIf((o) => o.contestId === undefined && o.buttonText !== undefined)
  @IsUrl({ require_tld: false }, { message: 'buttonUrl must be a valid URL' })
  @IsNotEmpty()
  buttonUrl?: string;
}
