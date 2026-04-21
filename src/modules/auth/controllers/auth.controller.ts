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

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      maxAge: 3600000, // 1 час
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      maxAge: 7 * 24 * 3600 * 1000, // 7 дней
    });

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
