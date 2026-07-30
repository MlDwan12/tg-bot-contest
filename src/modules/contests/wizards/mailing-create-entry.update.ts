import { Command, Ctx, Update } from 'nestjs-telegraf';
import { Scenes } from 'telegraf';
import { Logger } from 'nestjs-pino';
import { getAdminTelegramIdsFromEnv } from 'src/common/helpers/admin-ids.helper';
import { MAILING_CREATE_SCENE_ID } from './mailing-create.wizard';

/**
 * Точка входа в диалог рассылки. Живёт отдельно от визарда, чтобы команда
 * /newmailing ловилась и вне сцены — тот же приём, что у /newcontest.
 *
 * Авторизация — по ADMIN_IDS, как и у создания конкурса: рассылка не менее
 * (а по масштабу воздействия — более) чувствительное действие.
 */
@Update()
export class MailingCreateEntryUpdate {
  constructor(private readonly logger: Logger) {}

  @Command('newmailing')
  async newMailing(@Ctx() ctx: Scenes.WizardContext): Promise<void> {
    await this.enterCreateFlow(ctx);
  }

  /** Переиспользуется и командой /newmailing, и кнопкой меню «Рассылка». */
  async enterCreateFlow(ctx: Scenes.WizardContext): Promise<void> {
    const telegramId =
      ctx.from?.id !== undefined ? String(ctx.from.id) : undefined;

    if (!telegramId || !getAdminTelegramIdsFromEnv().includes(telegramId)) {
      this.logger.warn(
        { telegramId },
        'newmailing: попытка запуска не из ADMIN_IDS',
      );
      return;
    }

    await ctx.scene.enter(MAILING_CREATE_SCENE_ID, {
      initiatorTelegramId: telegramId,
    });
  }
}
