// src/modules/auth/guards/jwt-or-refresh.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const accessToken = req.cookies?.accessToken;
    const refreshToken = req.cookies?.refreshToken;

    if (!accessToken && !refreshToken) {
      this.logger.debug('No accessToken and no refreshToken');
      throw new UnauthorizedException('Не авторизован');
    }

    if (accessToken) {
      const accessUser =
        await this.authService.validateAccessToken(accessToken);

      if (accessUser) {
        req.user = accessUser;
        return true;
      }

      this.logger.debug('Access token invalid or expired');
    }

    if (!refreshToken) {
      this.logger.debug('Refresh token missing');
      throw new UnauthorizedException('Сессия истекла');
    }

    const refreshPayload =
      await this.authService.validateRefreshToken(refreshToken);

    if (!refreshPayload) {
      this.logger.debug('Refresh token invalid or expired');
      throw new UnauthorizedException('Сессия истекла');
    }

    const { accessToken: newAccessToken, user } =
      await this.authService.issueAccessTokenFromRefresh(refreshPayload);

    this.authService.setAccessCookie(res, newAccessToken);

    req.user = user;

    this.logger.debug(`Access token reissued for userId=${user.sub}`);

    return true;
  }
}
