import { UseFilters, UseGuards } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { Command, Ctx, On, Start, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import {
  BotAdminExceptionFilter,
  BotAdminGuard,
} from 'src/modules/contests/bot/bot-admin.guard';
import { TelegramUserService } from '../services/user-tg.service';
import { UsersService } from '../services/users.service';

const GREETING =
  '👋 Привет! Это бот наших розыгрышей.\n\n' +
  '🎁 Участвуй в конкурсах из наших каналов\n' +
  '🏆 Выиграешь — пришлём уведомление\n' +
  '📢 Первым узнавай о новых розыгрышах\n\n' +
  'Больше ничего делать не нужно — просто не блокируй бота 😉';

@Update()
export class UserStartUpdate {
  constructor(
    private readonly telegramUserService: TelegramUserService,
    private readonly usersService: UsersService,
    private readonly logger: Logger,
  ) {}

  @Start()
  async start(@Ctx() ctx: Context) {
    if (ctx.chat?.type !== 'private' || !ctx.from) return;

    try {
      await this.telegramUserService.registerBotStart(ctx.from);
    } catch (err: unknown) {
      // Приветствие важнее записи: юзер не должен остаться без ответа.
      this.logger.error(
        { err, from: ctx.from.id },
        '/start: не записали юзера',
      );
    }
    await ctx.reply(GREETING);
  }

  /**
   * Юзер разрешил боту писать, не нажимая /start: окно requestWriteAccess()
   * в мини-аппе или галочка при запуске мини-аппа по ссылке. Telegram
   * присылает об этом служебное сообщение — записываем как /start, но молча.
   */
  @On('write_access_allowed')
  async writeAccessAllowed(@Ctx() ctx: Context) {
    if (ctx.chat?.type !== 'private' || !ctx.from) return;
    try {
      await this.telegramUserService.registerBotStart(ctx.from);
    } catch (err: unknown) {
      this.logger.error(
        { err, from: ctx.from.id },
        'write_access_allowed: не записали юзера',
      );
    }
  }

  /** Сколько юзеров уже доступны этому боту — чтобы решить, когда гасить старый. */
  @Command('migration')
  @UseGuards(BotAdminGuard)
  @UseFilters(BotAdminExceptionFilter)
  async migration(@Ctx() ctx: Context) {
    const { started, total } = await this.usersService.countBotReach();
    const percent = total ? ((started / total) * 100).toFixed(1) : '0';
    await ctx.reply(
      `Перешли в новый бот: ${started} из ${total} (${percent}%)`,
    );
  }
}
