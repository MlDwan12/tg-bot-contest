import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: 'Логин администратора', example: 'admin' })
  @IsString()
  username: string;

  @ApiProperty({ description: 'Пароль администратора' })
  @IsString()
  password: string;
}
