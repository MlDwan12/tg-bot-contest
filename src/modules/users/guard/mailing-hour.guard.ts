import {
  CanActivate,
  ExecutionContext,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { getAppTimeZone } from 'src/common/helpers/app-timezone.helper';

/** Раньше этого часа рассылку запускать нельзя. */
const MAILING_ALLOWED_FROM_HOUR = 16;

/**
 * Запрещает запуск рассылки раньше положенного часа по часовому поясу
 * приложения (APP_TIME_ZONE, по умолчанию Europe/Moscow).
 *
 * Раньше назывался AfterMoscowTimeGuard и был жёстко привязан к Москве. Зона
 * стала настраиваемой — имя и текст ошибки больше не обещают конкретный город.
 */
@Injectable()
export class AfterMailingHourGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    const timeZone = getAppTimeZone();

    // Пересобираем дату из локализованной строки, чтобы getHours() отдал час
    // в нужной зоне, а не в зоне сервера.
    const zonedNow = new Date(new Date().toLocaleString('en-US', { timeZone }));

    if (zonedNow.getHours() < MAILING_ALLOWED_FROM_HOUR) {
      throw new BadRequestException(
        `Рассылку можно запускать только после ${MAILING_ALLOWED_FROM_HOUR}:00 (${timeZone})`,
      );
    }

    return true;
  }
}
