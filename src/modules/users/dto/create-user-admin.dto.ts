import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CreateUserAdmin } from 'src/shared/types/users';

export class CreateUserAdminDto implements CreateUserAdmin {
  @ApiProperty({
    description: 'Уникальное имя пользователя администратора',
    example: 'admin_user',
  })
  @IsString({ message: 'Username должен быть строкой' })
  @MinLength(3, { message: 'Username должен быть не меньше 3 символов' })
  @MaxLength(20, { message: 'Username должен быть не длиннее 20 символов' })
  @Transform(({ value }: { value: string }) => value.trim())
  login: string;

  @ApiProperty({
    description:
      'Пароль администратора (минимум 8 символов, должен содержать цифру и букву)',
    example: 'StrongPass123',
  })
  @IsString({ message: 'Password должен быть строкой' })
  @MinLength(8, { message: 'Password должен быть не меньше 8 символов' })
  @MaxLength(50, { message: 'Password должен быть не длиннее 50 символов' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password должен содержать хотя бы одну букву и одну цифру',
  })
  password: string;
}
