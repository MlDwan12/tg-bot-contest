import { Action, Ctx, Hears, Update } from 'nestjs-telegraf';
import { Context, Markup, Scenes } from 'telegraf';
import { Logger } from 'nestjs-pino';
import { ADMIN_MENU_BUTTONS } from 'src/modules/bot/bot.update';
import { getAdminTelegramIdsFromEnv } from 'src/common/helpers/admin-ids.helper';
import { getAppTimeZone } from 'src/common/helpers/app-timezone.helper';
import { ChannelPlatform } from 'src/common/enums/channel';
import { escapeHtml } from '../services/contest-results-text.util';
import { buildAllPostLinks } from '../services/contest-post-link.util';
import {
  GetContestsQueryDto,
  ContestSortBy,
  SortOrder,
} from '../dto/get-contests-query.dto';
import { ContestsService } from '../services/contests.service';
import { ContestPublicationService } from '../services/contest-publication.service';
import { ContestStatsService } from '../services/contest-stats.service';
import { ContestStatsDto } from '../dto/contest-stats.dto';
import { ContestExportService } from '../services/contest-export.service';
import { ChannelsService } from 'src/modules/channels/services';
import { AdminService } from 'src/modules/users/services';
import { TelegramService } from 'src/modules/bot/bot.service';
import { ContestCreateEntryUpdate } from './contest-create-entry.update';
import { MailingCreateEntryUpdate } from './mailing-create-entry.update';

const STATUS_LABELS: Record<string, string> = {
  draft: 'черновик',
  pending: 'ожидает старта',
  active: 'идёт',
  completed: 'завершён',
  cancelled: 'отменён',
};

const STATUS_EMOJI: Record<string, string> = {
  draft: '📝',
  pending: '⏳',
  active: '🟢',
  completed: '✅',
  cancelled: '🚫',
};

/** Статистика/CSV открываются отдельными сообщениями поверх списка — без
 * кнопки закрытия они просто копятся в чате (см. превью поста в визарде,
 * там та же кнопка). Callback общий для всех: удаляет ровно то сообщение,
 * к которому кнопка привязана. */
const CLOSE_KEYBOARD = Markup.inlineKeyboard([
  Markup.button.callback('✖ Закрыть', 'close_msg'),
]);

/** Хендлеры кнопок постоянного меню (см. bot.update.ts) — список конкурсов и
 * каналов только на чтение (MVP); управление — по-прежнему через API/мини-апп. */
@Update()
export class ContestMenuUpdate {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly contestPublicationService: ContestPublicationService,
    private readonly contestStatsService: ContestStatsService,
    private readonly contestExportService: ContestExportService,
    private readonly channelsService: ChannelsService,
    private readonly adminService: AdminService,
    private readonly telegramService: TelegramService,
    private readonly createEntry: ContestCreateEntryUpdate,
    private readonly mailingCreateEntry: MailingCreateEntryUpdate,
    private readonly logger: Logger,
  ) {}

  /** Публичный канал -> t.me/username, приватный -> t.me/c/<internalId> (без
   * message_id — просто открыть канал; работает только у тех, кто в нём состоит). */
  private buildChannelLink(
    externalId: string,
    externalUsername?: string,
  ): string | null {
    const username = externalUsername?.replace(/^@/, '').trim();
    if (username) return `https://t.me/${username}`;

    const internalId = externalId.replace(/^-100/, '').replace(/^-/, '');
    return /^\d+$/.test(internalId) ? `https://t.me/c/${internalId}` : null;
  }

  /** undefined, если отправитель не из ADMIN_IDS — вызывающий должен молча выйти. */
  private resolveAdminTelegramId(ctx: Context): string | undefined {
    const telegramId =
      ctx.from?.id !== undefined ? String(ctx.from.id) : undefined;
    if (!telegramId || !getAdminTelegramIdsFromEnv().includes(telegramId)) {
      return undefined;
    }
    return telegramId;
  }

  @Hears(ADMIN_MENU_BUTTONS.createContest)
  async createContest(@Ctx() ctx: Scenes.WizardContext): Promise<void> {
    if (!this.resolveAdminTelegramId(ctx)) return;
    await this.createEntry.enterCreateFlow(ctx);
  }

  @Hears(ADMIN_MENU_BUTTONS.mailing)
  async createMailing(@Ctx() ctx: Scenes.WizardContext): Promise<void> {
    if (!this.resolveAdminTelegramId(ctx)) return;
    await this.mailingCreateEntry.enterCreateFlow(ctx);
  }

  private static readonly CONTESTS_PAGE_SIZE = 5;

  @Hears(ADMIN_MENU_BUTTONS.myContests)
  async myContests(@Ctx() ctx: Context): Promise<void> {
    const telegramId = this.resolveAdminTelegramId(ctx);
    if (!telegramId) return;

    await this.renderContestsPage(ctx, telegramId, 1);
  }

  @Action(/^contests_page:(\d+)$/)
  async contestsPage(@Ctx() ctx: Context): Promise<void> {
    const telegramId = this.resolveAdminTelegramId(ctx);
    if (!telegramId) return;

    const query = ctx.callbackQuery;
    const data = query && 'data' in query ? query.data : undefined;
    const page = data ? Number(data.split(':')[1]) : NaN;

    if (!Number.isInteger(page)) {
      await ctx.answerCbQuery('Не понял номер страницы.');
      return;
    }
    await ctx.answerCbQuery();

    const message = query?.message;
    await this.renderContestsPage(
      ctx,
      telegramId,
      page,
      message
        ? { chatId: message.chat.id, messageId: message.message_id }
        : undefined,
    );
  }

  /** Один рендер и для первого открытия «Мои конкурсы», и для перелистывания
   * страниц — во втором случае редактируем то же сообщение, а не плодим новые. */
  private async renderContestsPage(
    ctx: Context,
    telegramId: string,
    page: number,
    editTarget?: { chatId: number; messageId: number },
  ): Promise<void> {
    const admin = await this.adminService.findOrCreateByTelegramId(telegramId);

    const result = await this.contestsService.getAllContestsShortInfo({
      page,
      limit: ContestMenuUpdate.CONTESTS_PAGE_SIZE,
      creatorId: admin.id,
      sortBy: ContestSortBy.CREATED_AT,
      sortOrder: SortOrder.DESC,
    } as GetContestsQueryDto);

    if (!result.items.length) {
      await ctx.reply('У тебя пока нет созданных конкурсов.');
      return;
    }

    const timeZone = getAppTimeZone();
    const formatDate = (date: Date) =>
      new Date(date).toLocaleString('ru-RU', {
        timeZone,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

    const postLinksByContest = await Promise.all(
      result.items.map(async (c) => {
        const publications =
          await this.contestPublicationService.getPublicationsByContestId(c.id);
        return buildAllPostLinks(
          publications.map((p) => ({
            chatId: p.chatId,
            telegramMessageId: p.telegramMessageId ?? null,
            channelUsername: p.channel?.externalUsername,
            channelTitle: p.channel?.name,
          })),
        );
      }),
    );

    const lines = result.items.map((c, index) => {
      const links = postLinksByContest[index];
      const postsLine = links.length
        ? `\n🔗 ${links.map((link, i) => `<a href="${link}">Пост ${i + 1}</a>`).join(' · ')}`
        : '';
      return `🏆 #${c.id} <b>${escapeHtml(c.name)}</b>\n${STATUS_EMOJI[c.status] ?? ''} ${STATUS_LABELS[c.status] ?? c.status} · ${formatDate(c.startDate)}→${formatDate(c.endDate)} · 👥 ${c.participantCount}${postsLine}`;
    });

    const text = `<b>Твои конкурсы</b> (стр. ${result.page}/${result.totalPages}, всего ${result.total}):\n\n${lines.join('\n\n')}`;

    const statsButtons = result.items.map((c) => [
      Markup.button.callback(`📊 Статистика #${c.id}`, `stats:${c.id}`),
      Markup.button.callback(`📄 CSV #${c.id}`, `csv:${c.id}`),
    ]);

    const pagerRow = [
      result.hasPrevPage
        ? Markup.button.callback('◀️ Назад', `contests_page:${result.page - 1}`)
        : undefined,
      result.hasNextPage
        ? Markup.button.callback('▶️ Ещё', `contests_page:${result.page + 1}`)
        : undefined,
    ].filter((btn): btn is NonNullable<typeof btn> => btn !== undefined);

    const keyboard = Markup.inlineKeyboard(
      pagerRow.length ? [...statsButtons, pagerRow] : statsButtons,
    );

    // Ссылки на посты — обычный текст, но Telegram по умолчанию разворачивает
    // t.me-ссылки в огромную карточку с превью (см. buildAllPostLinks) — на
    // 5 конкурсах с постами сообщение стало бы нечитаемо длинным.
    const extra = {
      parse_mode: 'HTML' as const,
      link_preview_options: { is_disabled: true },
      ...keyboard,
    };

    if (editTarget) {
      await ctx.telegram.editMessageText(
        editTarget.chatId,
        editTarget.messageId,
        undefined,
        text,
        extra,
      );
    } else {
      await ctx.reply(text, extra);
    }
  }

  @Action(/^stats:(\d+)$/)
  async showStats(@Ctx() ctx: Context): Promise<void> {
    if (!this.resolveAdminTelegramId(ctx)) return;

    const query = ctx.callbackQuery;
    const data = query && 'data' in query ? query.data : undefined;
    const contestId = data ? Number(data.split(':')[1]) : NaN;

    if (!Number.isInteger(contestId)) {
      await ctx.answerCbQuery('Не понял, какой конкурс.');
      return;
    }

    await ctx.answerCbQuery();

    let stats: ContestStatsDto;
    try {
      stats = await this.contestStatsService.getContestStats(contestId);
    } catch (error) {
      await ctx.reply(
        error instanceof Error
          ? error.message
          : `Не удалось получить статистику конкурса #${contestId}.`,
      );
      return;
    }

    const lines = [
      `<b>📊 Статистика #${stats.contestId}</b>`,
      '',
      `👥 Участников: ${stats.participantsTotal} (валидных: ${stats.participantsValid}, отписалось: ${stats.participantsUnsubscribed})`,
      `🏆 Места заполнены: ${stats.placesFilled}/${stats.prizePlaces}`,
      `✅ Подтвердили приз: ${stats.winnersConfirmed}`,
      `⏳ Ожидают решения: ${stats.winnersPending}`,
      `❌ Отказались: ${stats.winnersDeclined}`,
      `⌛ Просрочили: ${stats.winnersExpired}`,
      `📨 Уведомлений доставлено: ${stats.notificationsDelivered}, не доставлено: ${stats.notificationsFailed}`,
    ];

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      ...CLOSE_KEYBOARD,
    });
  }

  @Action('close_msg')
  async closeMessage(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    const message = ctx.callbackQuery?.message;
    if (!message) return;
    try {
      await ctx.telegram.deleteMessage(message.chat.id, message.message_id);
    } catch (error) {
      this.logger.debug(
        { err: error },
        'contest-menu: не удалось закрыть сообщение',
      );
    }
  }

  @Action(/^csv:(\d+)$/)
  async exportCsv(@Ctx() ctx: Context): Promise<void> {
    if (!this.resolveAdminTelegramId(ctx)) return;

    const query = ctx.callbackQuery;
    const data = query && 'data' in query ? query.data : undefined;
    const contestId = data ? Number(data.split(':')[1]) : NaN;

    if (!Number.isInteger(contestId)) {
      await ctx.answerCbQuery('Не понял, какой конкурс.');
      return;
    }

    await ctx.answerCbQuery('Собираю CSV…');

    try {
      let csv = '';
      for await (const chunk of this.contestExportService.streamParticipantsCsv(
        contestId,
      )) {
        csv += chunk;
      }

      await ctx.replyWithDocument(
        {
          source: Buffer.from(csv, 'utf-8'),
          filename: this.contestExportService.buildFileName(contestId),
        },
        { ...CLOSE_KEYBOARD },
      );
    } catch (error) {
      await ctx.reply(
        error instanceof Error
          ? error.message
          : `Не удалось выгрузить CSV конкурса #${contestId}.`,
      );
    }
  }

  @Hears(ADMIN_MENU_BUTTONS.myChannels)
  async myChannels(@Ctx() ctx: Context): Promise<void> {
    const telegramId = this.resolveAdminTelegramId(ctx);
    if (!telegramId) return;

    const channels = await this.channelsService.getActiveChannels();
    const telegramChannels = channels.filter(
      (c) => c.platform === ChannelPlatform.TELEGRAM && c.externalId != null,
    );

    const isAdminByChannel = await Promise.all(
      telegramChannels.map((c) =>
        this.telegramService.isUserChannelAdmin(
          Number(c.externalId),
          Number(telegramId),
        ),
      ),
    );
    const myChannels = telegramChannels.filter(
      (_, index) => isAdminByChannel[index],
    );

    if (!myChannels.length) {
      await ctx.reply('Каналов, где ты админ, не нашлось.');
      return;
    }

    const lines = myChannels.map((c) => {
      const link = this.buildChannelLink(
        c.externalId as string,
        c.externalUsername,
      );
      const title = escapeHtml(
        c.name ?? c.externalUsername ?? (c.externalId as string),
      );
      const label = link ? `<a href="${link}">${title}</a>` : title;
      return `📂 #${c.id} <b>${label}</b>`;
    });

    await ctx.reply(`<b>Твои каналы</b>:\n\n${lines.join('\n')}`, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }
}
