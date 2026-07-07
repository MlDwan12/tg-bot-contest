import {
  Controller,
  Post,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { LoginDto } from '../dto';
import { AuthService } from '../services';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../guards';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  // Переопределяем глобальный лимит (100/60s) на строгий для логина:
  // 5 попыток в 15 минут с одного IP.
  // Это защита от брутфорса: при скорости перебора 1 пароль/3 минуты
  // 1 миллиард паролей займёт ~190 лет.
  @Throttle({ global: { ttl: 900, limit: 5 } })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const admin = await this.authService.validateAdmin(
      dto.username,
      dto.password,
    );
    const { accessToken, refreshToken } =
      await this.authService.getTokens(admin);

    const isProd = this.configService.get('NODE_ENV') === 'production';

    this.authService.setAccessCookie(res, accessToken);
    this.authService.setRefreshCookie(res, refreshToken);

    return { message: 'Успешный вход' };
  }

  @Get('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response) {
    this.authService.clearAuthCookies(res);
    return { message: 'Вы успешно вышли из системы' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me() {
    return {
      success: true,
    };
  }
}
