import {
  ArgumentsHost,
  BadRequestException,
  CanActivate,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { TelegrafArgumentsHost, TelegrafExecutionContext } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { UserRole } from 'src/common/enums/user/user-role.enum';
import { getAdminTelegramIdsFromEnv } from 'src/common/helpers/admin-ids.helper';
import { UsersService } from 'src/modules/users/services/users.service';

/**
 * Пускает в админ-панель бота, только если telegram id есть в
 * ADMIN_IDS И пользователь в БД с role=ADMIN. Висит на всём классе
 * панели — обработчик без проверки добавить нельзя (callback_data подделывается,
 * скрытая кнопка защитой не является).
 */
@Injectable()
export class BotAdminGuard implements CanActivate {
  constructor(
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = TelegrafExecutionContext.create(context).getContext<Context>();
    const telegramId = ctx.from?.id ? String(ctx.from.id) : null;

    // Сначала env — случайный юзер не порождает запрос в БД.
    if (!telegramId || !getAdminTelegramIdsFromEnv().includes(telegramId)) {
      return false;
    }

    const user = await this.usersService.findByTelegramId(telegramId);
    return user?.role === UserRole.ADMIN;
  }
}

/**
 * Ловит всё, что вылетело из панели. Без него отказ guard'а (ForbiddenException)
 * или любая ошибка ушли бы в Telegraf, где bot.catch не задан, — это может
 * остановить polling для всех пользователей бота.
 */
@Catch()
export class BotAdminExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = TelegrafArgumentsHost.create(host).getContext<Context>();
    const isCallback = Boolean(ctx.callbackQuery);

    try {
      if (exception instanceof BadRequestException) {
        // Ожидаемая ошибка с понятным админу текстом (конкурс не активен и т.п.)
        const text = exception.message;
        if (isCallback) await ctx.answerCbQuery(text, { show_alert: true });
        else await ctx.reply(text);
        return;
      }

      // Не-админ (отказ guard'а) — молчим, чтобы не выдавать существование панели.
      // Прочие ошибки логируем; "message is not modified" — безвредный повтор.
      if (!(exception instanceof ForbiddenException)) {
        this.logger.warn(
          { err: exception, from: ctx.from?.id },
          'Ошибка в админ-панели бота',
        );
      }
      if (isCallback) await ctx.answerCbQuery();
    } catch (err) {
      this.logger.warn({ err }, 'Не удалось ответить в админ-панели бота');
    }
  }
}
