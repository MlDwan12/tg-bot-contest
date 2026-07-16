import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * ThrottlerGuard, ограниченный HTTP-контекстом.
 *
 * APP_GUARD вешается на ВСЕ обработчики, а не только на HTTP-роуты — в том
 * числе на листенеры Telegraf (@Start/@Command). Базовый ThrottlerGuard
 * безусловно берёт res через switchToHttp() и пишет в него rate-limit
 * заголовки; вне HTTP такого res нет → `res.header is not a function`, и
 * обработчик бота падает ДО пользовательского кода.
 *
 * shouldSkip() — штатная точка расширения: canActivate() зовёт её первой,
 * до любой работы с лимитом.
 */
@Injectable()
export class HttpOnlyThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return context.getType() !== 'http';
  }
}
