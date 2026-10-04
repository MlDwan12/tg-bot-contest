import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Markup, Telegraf } from 'telegraf';

const MOVED_TEXT =
  '⚠️ Скоро этот бот будет отключён.\n\n' +
  'Чтобы не пропустить новые розыгрыши и получить уведомление, если выиграешь, ' +
  'перейди в новый бот 👇';

/**
 * Старый бот на время переезда пользователей (LEGACY_BOT_TOKEN).
 * Новый бот не может написать тому, кто не нажал у него /start, поэтому личка
 * (рассылки, уведомления победителям) идёт через старого, а на любое сообщение
 * ему он отвечает «мы переехали» со ссылкой на нового.
 * Без LEGACY_BOT_TOKEN bot = null и сервис ничего не делает.
 */
@Injectable()
export class LegacyBotService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  readonly bot: Telegraf | null;

  constructor(
    config: ConfigService,
    @InjectBot() private readonly mainBot: Telegraf,
    private readonly logger: Logger,
  ) {
    const token = config.get<string>('LEGACY_BOT_TOKEN');
    this.bot = token ? new Telegraf(token) : null;
  }

  async onApplicationBootstrap() {
    if (!this.bot) return;

    // Юзернейма в токене нет — спрашиваем у Telegram, кто такой новый бот.
    const { username } = await this.mainBot.telegram.getMe();
    const keyboard = Markup.inlineKeyboard([
      Markup.button.url(
        'Перейти в новый бот',
        `https://t.me/${username}?start=moved`,
      ),
    ]);

    this.bot.on(['message', 'callback_query'], async (ctx: Context) => {
      // Только личка: в группах бот не должен отвечать на каждое сообщение.
      if (ctx.chat?.type !== 'private') return;
      if (ctx.callbackQuery) await ctx.answerCbQuery();
      await ctx.reply(MOVED_TEXT, keyboard);
    });

    // Без catch ошибка в обработчике (юзер заблокировал бота и т.п.)
    // остановила бы polling.
    this.bot.catch((err) =>
      this.logger.warn({ err }, 'Старый бот: ошибка в обработчике'),
    );

    // launch() резолвится только при остановке polling — не ждём его.
    this.bot
      .launch()
      .catch((err: unknown) =>
        this.logger.error({ err }, 'Старый бот не запустился'),
      );
    this.logger.log(`Старый бот запущен, ведёт в @${username}`);
  }

  onModuleDestroy() {
    try {
      this.bot?.stop('shutdown');
    } catch {
      // stop() кидает, если polling так и не стартовал — при выключении неважно.
    }
  }
}
