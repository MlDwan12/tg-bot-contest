import { Command, Ctx, Update } from 'nestjs-telegraf';
import { Scenes } from 'telegraf';
import { Logger } from 'nestjs-pino';
import { getAdminTelegramIdsFromEnv } from 'src/common/helpers/admin-ids.helper';
import { AdminService } from 'src/modules/users/services';
import { CONTEST_CREATE_SCENE_ID } from './contest-create.wizard';

/**
 * Точка входа в диалог создания конкурса. Живёт отдельно от самого визарда,
 * чтобы команда /newcontest ловилась и вне сцены (обычным ботом), а не только
 * внутри неё.
 *
 * Авторизация — по ADMIN_IDS (тот же env, что и для рассылки уведомлений
 * админам): решение 2026-07-30, чтобы не городить отдельную привязку
 * Telegram-аккаунтов к админам.
 */
@Update()
export class ContestCreateEntryUpdate {
  constructor(
    private readonly adminService: AdminService,
    private readonly logger: Logger,
  ) {}

  @Command('newcontest')
  async newContest(@Ctx() ctx: Scenes.WizardContext): Promise<void> {
    await this.enterCreateFlow(ctx);
  }

  /** Переиспользуется и командой /newcontest, и кнопкой меню «Создать конкурс». */
  async enterCreateFlow(ctx: Scenes.WizardContext): Promise<void> {
    const telegramId =
      ctx.from?.id !== undefined ? String(ctx.from.id) : undefined;

    if (!telegramId || !getAdminTelegramIdsFromEnv().includes(telegramId)) {
      this.logger.warn(
        { telegramId },
        'newcontest: попытка запуска не из ADMIN_IDS',
      );
      return;
    }

    const admin = await this.adminService.findOrCreateByTelegramId(telegramId);

    await ctx.scene.enter(CONTEST_CREATE_SCENE_ID, {
      creatorId: admin.id,
      publishChannelExternalIds: [],
      requiredChannelExternalIds: [],
    });
  }
}
