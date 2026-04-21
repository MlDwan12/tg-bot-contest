import {
  CanActivate,
  ExecutionContext,
  Injectable,
  BadRequestException,
} from '@nestjs/common';

@Injectable()
export class AfterMoscowTimeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const now = new Date();

    const moscowTime = new Date(
      now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }),
    );

    const hours = moscowTime.getHours();

    if (hours < 16) {
      throw new BadRequestException(
        'Рассылку можно запускать только после 16:00 по МСК',
      );
    }

    return true;
  }
}
