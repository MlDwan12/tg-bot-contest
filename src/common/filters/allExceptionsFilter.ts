import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import * as Sentry from '@sentry/node';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') {
      // Необработанное исключение вне HTTP (фон/очереди/жизненный цикл) —
      // это всегда «неожиданно», шлём в Sentry.
      Sentry.captureException(exception);
      this.logger.error(
        {
          error: exception instanceof Error ? exception.message : String(exception),
          stack: exception instanceof Error ? exception.stack : undefined,
        },
        'Unhandled exception (non-HTTP context)',
      );
      return;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    if (status >= 500) {
      // Только серверные ошибки (5xx) идут в Sentry. Клиентские 4xx
      // (валидация, 401/403/404 и т.п.) — ожидаемы, их не шлём, чтобы
      // не засорять Sentry шумом.
      Sentry.captureException(exception);
      this.logger.error(
        {
          method: request.method,
          url: request.url,
          status,
          error: exception instanceof Error ? exception.message : String(exception),
          stack: exception instanceof Error ? exception.stack : undefined,
        },
        `Unhandled exception: ${request.method} ${request.url}`,
      );
    }

    response.status(status).json({
      success: false,
      status,
      data: message,
    });
  }
}
