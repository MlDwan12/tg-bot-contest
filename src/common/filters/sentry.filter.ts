import * as Sentry from '@sentry/node';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';

@Catch()
export class SentryFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // 1) отправляем в Sentry
    Sentry.captureException(exception);

    // 2) дальше отдаём ответ клиенту как обычно
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();

      const res = exception.getResponse();
      return response.status(status).json(res);
    }

    // неизвестная ошибка
    return response.status(500).json({
      message: 'Internal server error',
    });
  }
}
