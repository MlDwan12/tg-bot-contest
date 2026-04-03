import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AdminService } from 'src/modules/users/services';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(
    private adminService: AdminService,
    private jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async validateAdmin(username: string, pass: string) {
    const admin = await this.adminService.findByLogin(username);

    if (!admin) {
      throw new UnauthorizedException('Неверные учетные данные');
    }

    const isMatch = await bcrypt.compare(pass, admin.passwordHash!);

    if (!isMatch) {
      throw new UnauthorizedException('Неверные учетные данные');
    }

    return admin;
  }

  async getTokens(admin: { id: number; username: string; role: string }) {
    const payload = {
      sub: admin.id,
      username: admin.username,
      role: admin.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_ACCESS_SECRET'),
        expiresIn: '1h',
      }),

      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
