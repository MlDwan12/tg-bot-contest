import { Update, Ctx, Start, Help, Command } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { getAdminTelegramIdsFromEnv } from 'src/common/helpers/admin-ids.helper';

export const ADMIN_MENU_BUTTONS = {
  createContest: '🎲 Создать конкурс',
  myContests: '📁 Мои конкурсы',
  myChannels: '📂 Мои каналы',
  mailing: '📢 Рассылка',
} as const;

@Update()
export class BotUpdate {
  @Start()
  async start(@Ctx() ctx: Context) {
    const telegramId =
      ctx.from?.id !== undefined ? String(ctx.from.id) : undefined;
    const isAdmin = Boolean(
      telegramId && getAdminTelegramIdsFromEnv().includes(telegramId),
    );

    if (!isAdmin) {
      await ctx.reply('Hello! I am a bot created with nestjs-telegraf.');
      return;
    }

    await ctx.reply(
      '👋 <b>С возвращением!</b>\n\n' +
        'Это панель управления конкурсным ботом. Отсюда можно запустить новый ' +
        'конкурс, посмотреть уже созданные и каналы, где ты администратор.',
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([
          [ADMIN_MENU_BUTTONS.createContest, ADMIN_MENU_BUTTONS.mailing],
          [ADMIN_MENU_BUTTONS.myContests, ADMIN_MENU_BUTTONS.myChannels],
        ]).resize(),
      },
    );
  }

  @Help()
  async help(@Ctx() ctx: Context) {
    await ctx.reply('This is a help message.');
  }

  @Command('echo')
  async echo(@Ctx() ctx: Context) {
    await ctx.reply('Echo!');
  }
}
