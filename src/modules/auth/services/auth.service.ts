import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AdminService } from 'src/modules/users/services';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { User } from 'src/modules/users/entities';

export interface AccessTokenPayload {
  sub: number;
  role: string;
  login?: string | null;
  telegramId?: string | null;
}

export interface RefreshTokenPayload {
  sub: number;
  tokenVersion?: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly adminService: AdminService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async validateAdmin(login: string, pass: string) {
    const admin = await this.adminService.findByLogin(login);

    if (!admin) {
      throw new UnauthorizedException('Неверные учетные данные');
    }

    const isMatch = await bcrypt.compare(pass, admin.passwordHash!);

    if (!isMatch) {
      throw new UnauthorizedException('Неверные учетные данные');
    }

    return admin;
  }

  async getTokens(admin: User) {
    const payload: AccessTokenPayload = {
      sub: admin.id,
      role: admin.role,
      login: admin.login ?? null,
      telegramId: admin.telegramId ?? null,
    };

    const refreshPayload: RefreshTokenPayload = {
      sub: admin.id,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: '1h',
      }),

      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      }),
    ]);

    return { accessToken, refreshToken };
  }

  async validateAccessToken(token: string): Promise<AccessTokenPayload | null> {
    try {
      return await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      return null;
    }
  }

  async validateRefreshToken(
    token: string,
  ): Promise<RefreshTokenPayload | null> {
    try {
      return await this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      return null;
    }
  }

  async issueAccessTokenFromRefresh(
    refreshPayload: RefreshTokenPayload,
  ): Promise<{
    accessToken: string;
    user: AccessTokenPayload;
  }> {
    const userEntity = await this.adminService.findById(refreshPayload.sub);

    if (!userEntity) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    const user = this.buildAccessPayload(userEntity);

    const accessToken = await this.jwtService.signAsync(user, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: '15m',
    });

    return {
      accessToken,
      user,
    };
  }

  buildAccessPayload(user: User): AccessTokenPayload {
    return {
      sub: user.id,
      role: user.role,
      login: user.login ?? null,
      telegramId: user.telegramId ?? null,
    };
  }

  setAccessCookie(res: Response, token: string) {
    res.cookie('accessToken', token, {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      sameSite:
        this.configService.get<string>('NODE_ENV') === 'production'
          ? 'none'
          : 'lax',
      path: '/',
      maxAge: 15 * 60 * 1000,
    });
  }

  setRefreshCookie(res: Response, token: string) {
    res.cookie('refreshToken', token, {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      sameSite:
        this.configService.get<string>('NODE_ENV') === 'production'
          ? 'none'
          : 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  clearAuthCookies(res: Response) {
    const secure = this.configService.get<string>('NODE_ENV') === 'production';
    const sameSite = secure ? 'none' : 'lax';

    res.clearCookie('accessToken', {
      path: '/',
      httpOnly: true,
      secure,
      sameSite,
    });

    res.clearCookie('refreshToken', {
      path: '/',
      httpOnly: true,
      secure,
      sameSite,
    });
  }
}
