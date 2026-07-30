import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, any> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Интерцептор глобальный (app.useGlobalInterceptors), а NestJS применяет
    // глобальные интерцепторы ко ВСЕМ типам контекста, включая кастомный
    // 'telegraf' у nestjs-telegraf. Без этой проверки хендлеры бота получают
    // {success, status, data} вместо void/undefined, и там, где
    // nestjs-telegraf трактует truthy-результат как «нужно ответить»
    // (registerIfListener: `if (result) ctx.reply(String(result))`),
    // в чат уходит буквально "[object Object]".
    if (context.getType() !== 'http') {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        const response = context.switchToHttp().getResponse();

        return {
          success: true,
          status: response.statusCode,
          data,
        };
      }),
    );
  }
}
