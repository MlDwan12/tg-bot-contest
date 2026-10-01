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
    // Глобальный интерцептор вешается и на листенеры Telegraf. nestjs-telegraf
    // отправляет в чат всё, что вернул обработчик, — обёртка уходила
    // сообщением "[object Object]".
    if (context.getType() !== 'http') return next.handle();

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
