import { Update, Ctx, Start, Help, Command } from 'nestjs-telegraf';
import { Context } from 'telegraf';

@Update()
export class BotUpdate {
  @Start()
  async start(@Ctx() ctx: Context) {
    await ctx.reply('Hello! I am a bot created with nestjs-telegraf.');
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
