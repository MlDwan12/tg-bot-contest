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
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopedResponseRaw } from 'src/common/swagger/api-enveloped-response.decorator';

@ApiTags('auth')
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
  @ApiOperation({
    summary: 'Вход администратора',
    description:
      'Логин + пароль. При успехе выставляет httpOnly cookie accessToken ' +
      '(15 мин) и refreshToken (30 дней) — тело ответа их не содержит. ' +
      'Ограничение: 5 попыток / 15 минут с одного IP.',
  })
  @ApiBody({ type: LoginDto })
  @ApiEnvelopedResponseRaw(
    { type: 'object', properties: { message: { type: 'string' } } },
    { description: 'Вход выполнен, cookie выставлены' },
  )
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

  @ApiOperation({
    summary: 'Выход',
    description: 'Очищает accessToken/refreshToken cookie.',
  })
  @ApiEnvelopedResponseRaw({
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @Get('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response) {
    this.authService.clearAuthCookies(res);
    return { message: 'Вы успешно вышли из системы' };
  }

  @ApiOperation({
    summary: 'Проверка сессии',
    description:
      'Возвращает 200, если accessToken/refreshToken cookie валидны ' +
      '(JwtAuthGuard по пути их ротирует), иначе 401.',
  })
  @ApiCookieAuth('accessToken')
  @ApiEnvelopedResponseRaw({
    type: 'object',
    properties: { success: { type: 'boolean', example: true } },
  })
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me() {
    return {
      success: true,
    };
  }
}
