import { Ctx, Wizard, WizardStep, Command } from 'nestjs-telegraf';
import { Markup, Scenes } from 'telegraf';
import { InlineKeyboardMarkup } from '@telegraf/types';
import { Logger } from 'nestjs-pino';
import { NotFoundException } from '@nestjs/common';
import { UserMailingType } from 'src/common/enums/user/user-mailing-type.enum';
import { ChannelPlatform } from 'src/common/enums/channel';
import { ChannelsService } from 'src/modules/channels/services';
import { TelegramService } from 'src/modules/bot/bot.service';
import { UsersMailingService } from 'src/modules/users/services/users-mailing.service';
import {
  CustomEmojiEntity,
  renderTextWithCustomEmoji,
  extractCustomEmojiEntities,
} from './custom-emoji.util';
import { downloadTelegramPhotoAsMailingImage } from './download-telegram-photo.helper';
import { escapeHtml } from '../services/contest-results-text.util';

export const MAILING_CREATE_SCENE_ID = 'mailing-create';

type AwaitingField = 'userId' | 'text' | 'image' | 'buttonText' | 'buttonUrl';

interface MailingCreateWizardState {
  initiatorTelegramId: string;

  type?: UserMailingType;
  userId?: number;
  groupId?: string;
  groupLabel?: string;

  text?: string;
  textEntities?: CustomEmojiEntity[];
  imageFile?: Express.Multer.File;
  buttonText?: string;
  buttonUrl?: string;

  activeGroups?: Array<{ externalId: string; label: string }>;

  cardChatId?: number;
  cardMessageId?: number;
  awaitingField?: AwaitingField;
  lastPromptMessageId?: number;
}

type WizardContext = Scenes.WizardContext;

const AUDIENCE_LABELS: Record<UserMailingType, string> = {
  [UserMailingType.USER]: 'Один пользователь',
  [UserMailingType.GROUP]: 'Группа (канал)',
  [UserMailingType.ALL]: 'Все пользователи',
};

/**
 * Диалог рассылки прямо из чата с ботом — та же карточка-панель, что и у
 * создания конкурса (см. contest-create.wizard.ts), но действие куда более
 * необратимое: отправка уходит реальным людям сразу в очередь. Поэтому перед
 * реальной отправкой обязателен отдельный шаг с посчитанным числом
 * получателей — этого нет в UsersMailingService.sendMailing самом по себе
 * (см. UsersMailingService.previewRecipients).
 */
@Wizard(MAILING_CREATE_SCENE_ID)
export class MailingCreateWizard {
  constructor(
    private readonly usersMailingService: UsersMailingService,
    private readonly channelsService: ChannelsService,
    private readonly telegramService: TelegramService,
    private readonly logger: Logger,
  ) {}

  @Command('cancel')
  async cancel(@Ctx() ctx: WizardContext): Promise<void> {
    await ctx.reply('Рассылка отменена.');
    await ctx.scene.leave();
  }

  private state(ctx: WizardContext): MailingCreateWizardState {
    return ctx.wizard.state as MailingCreateWizardState;
  }

  @WizardStep(0)
  async stepEnter(@Ctx() ctx: WizardContext): Promise<void> {
    const message = await ctx.reply(this.buildCardText(this.state(ctx)), {
      parse_mode: 'HTML',
      ...this.buildCardKeyboard(),
    });
    this.state(ctx).cardChatId = message.chat.id;
    this.state(ctx).cardMessageId = message.message_id;
    ctx.wizard.next();
  }

  @WizardStep(1)
  async listen(@Ctx() ctx: WizardContext): Promise<void> {
    const query = ctx.callbackQuery;
    const data = query && 'data' in query ? query.data : undefined;

    if (data !== undefined) {
      await this.handleCallback(ctx, data);
      return;
    }

    await this.handleAnswer(ctx);
  }

  // ── диспетчеризация ──────────────────────────────────────────────────────

  private async handleCallback(
    ctx: WizardContext,
    data: string,
  ): Promise<void> {
    if (data.startsWith('card:')) {
      await ctx.answerCbQuery();
      await this.handleCardButton(ctx, data.slice('card:'.length));
      return;
    }

    if (data.startsWith('aud:')) {
      await this.handleAudienceTap(ctx, data.slice('aud:'.length));
      return;
    }

    if (data.startsWith('grp:')) {
      await this.handleGroupTap(ctx, data.slice('grp:'.length));
      return;
    }

    if (data.startsWith('send:')) {
      await this.handleSendConfirmation(ctx, data.slice('send:'.length));
      return;
    }

    if (data === 'preview:close') {
      await ctx.answerCbQuery();
      const message = ctx.callbackQuery?.message;
      if (message) {
        try {
          await ctx.telegram.deleteMessage(message.chat.id, message.message_id);
        } catch (error) {
          this.logger.debug(
            { err: error },
            'mailing-create-wizard: не удалось закрыть превью',
          );
        }
      }
      return;
    }

    await ctx.answerCbQuery('Не понял нажатие.');
  }

  private async handleCardButton(
    ctx: WizardContext,
    key: string,
  ): Promise<void> {
    switch (key) {
      case 'audience':
        await this.deleteLastPrompt(ctx);
        {
          const message = await ctx.reply(
            'Кому отправляем?',
            Markup.inlineKeyboard([
              [Markup.button.callback('👤 Один пользователь', 'aud:user')],
              [Markup.button.callback('👥 Группа (канал)', 'aud:group')],
              [Markup.button.callback('🌍 Все пользователи', 'aud:all')],
            ]),
          );
          this.state(ctx).lastPromptMessageId = message.message_id;
        }
        return;
      case 'text':
        await this.promptField(ctx, 'text', 'Текст рассылки?');
        return;
      case 'image':
        await this.promptField(
          ctx,
          'image',
          'Пришли картинку (фото) или «-», чтобы убрать.',
        );
        return;
      case 'button':
        await this.promptField(
          ctx,
          'buttonText',
          'Текст кнопки? (или «-», чтобы убрать кнопку)',
        );
        return;
      case 'preview':
        await this.sendPreview(ctx);
        return;
      case 'send':
        await this.startSendConfirmation(ctx);
        return;
      case 'cancel':
        await ctx.reply('Рассылка отменена.');
        await ctx.scene.leave();
        return;
      default:
        this.logger.warn(
          { key },
          'mailing-create-wizard: неизвестная кнопка карточки',
        );
    }
  }

  private async handleAudienceTap(
    ctx: WizardContext,
    value: string,
  ): Promise<void> {
    const state = this.state(ctx);

    if (value === 'user') {
      await ctx.answerCbQuery();
      state.type = UserMailingType.USER;
      await this.promptField(ctx, 'userId', 'Telegram ID получателя?');
      return;
    }

    if (value === 'all') {
      state.type = UserMailingType.ALL;
      state.userId = undefined;
      state.groupId = undefined;
      state.groupLabel = undefined;
      await ctx.answerCbQuery('Все пользователи');
      await this.deleteLastPrompt(ctx);
      await this.renderCard(ctx);
      return;
    }

    if (value === 'group') {
      await ctx.answerCbQuery();
      const channels = await this.channelsService.getActiveChannels();
      const telegramChannels = channels.filter(
        (c) => c.platform === ChannelPlatform.TELEGRAM && c.externalId != null,
      );
      const isAdminByChannel = await Promise.all(
        telegramChannels.map((c) =>
          this.telegramService.isUserChannelAdmin(
            Number(c.externalId),
            Number(state.initiatorTelegramId),
          ),
        ),
      );
      state.activeGroups = telegramChannels
        .filter((_, index) => isAdminByChannel[index])
        .map((c) => ({
          externalId: c.externalId as string,
          label: c.name ?? c.externalUsername ?? (c.externalId as string),
        }));

      if (!state.activeGroups.length) {
        await ctx.reply('Каналов, где ты админ, не нашлось.');
        return;
      }

      await this.deleteLastPrompt(ctx);
      const message = await ctx.reply(
        'В каком канале искать участников?',
        Markup.inlineKeyboard(
          state.activeGroups.map((g) => [
            Markup.button.callback(g.label, `grp:${g.externalId}`),
          ]),
        ),
      );
      state.lastPromptMessageId = message.message_id;
      return;
    }

    await ctx.answerCbQuery();
  }

  private async handleGroupTap(
    ctx: WizardContext,
    externalId: string,
  ): Promise<void> {
    const state = this.state(ctx);
    const group = state.activeGroups?.find((g) => g.externalId === externalId);

    state.type = UserMailingType.GROUP;
    state.groupId = externalId;
    state.groupLabel = group?.label ?? externalId;
    state.userId = undefined;

    await ctx.answerCbQuery(state.groupLabel);
    await this.deleteLastPrompt(ctx);
    await this.renderCard(ctx);
  }

  private async handleAnswer(ctx: WizardContext): Promise<void> {
    const state = this.state(ctx);
    const field = state.awaitingField;
    if (!field) {
      await ctx.reply(
        'Нажми одну из кнопок на карточке выше ⬆️ (или /cancel, чтобы выйти).',
      );
      return;
    }

    switch (field) {
      case 'userId': {
        const text = this.readText(ctx);
        const value = text ? Number(text) : NaN;
        if (!Number.isInteger(value) || value <= 0) {
          await ctx.reply('Нужен положительный целый telegram ID. Повтори:');
          return;
        }
        state.userId = value;
        await this.finishAnswer(ctx);
        return;
      }
      case 'text': {
        const entities = this.readCustomEmojiEntities(ctx);
        const raw = this.readRawText(ctx);
        const text = entities ? raw : raw?.trim();
        if (!text) {
          await ctx.reply('Текст не может быть пустым. Повтори:');
          return;
        }
        state.text = text;
        state.textEntities = entities;
        await this.finishAnswer(ctx);
        return;
      }
      case 'image': {
        const message = ctx.message;
        if (message && 'photo' in message && message.photo.length) {
          try {
            const largest = message.photo[message.photo.length - 1];
            const fileUrl = await ctx.telegram.getFileLink(largest.file_id);
            state.imageFile = await downloadTelegramPhotoAsMailingImage(
              fileUrl.href,
            );
          } catch (error) {
            this.logger.warn(
              { err: error },
              'mailing-create-wizard: не удалось скачать картинку из Telegram',
            );
            await ctx.reply(
              'Не удалось скачать картинку, попробуй ещё раз или пришли «-».',
            );
            return;
          }
        } else {
          const text = this.readText(ctx);
          if (text !== '-') {
            await ctx.reply('Пришли фото или «-», чтобы убрать картинку.');
            return;
          }
          state.imageFile = undefined;
        }
        await this.finishAnswer(ctx);
        return;
      }
      case 'buttonText': {
        const text = this.readText(ctx);
        if (text === undefined) {
          await ctx.reply('Пришли текст кнопки или «-».');
          return;
        }
        if (text === '-') {
          state.buttonText = undefined;
          state.buttonUrl = undefined;
          await this.finishAnswer(ctx);
          return;
        }
        state.buttonText = text;
        await this.promptField(ctx, 'buttonUrl', 'Ссылка на кнопку (URL)?');
        return;
      }
      case 'buttonUrl': {
        const text = this.readText(ctx);
        if (!text || !this.isValidUrl(text)) {
          await ctx.reply(
            'Нужна корректная ссылка (начинается с http:// или https://). Повтори:',
          );
          return;
        }
        state.buttonUrl = text;
        await this.finishAnswer(ctx);
        return;
      }
    }
  }

  // ── отправка: подтверждение с числом получателей ────────────────────────

  private async startSendConfirmation(ctx: WizardContext): Promise<void> {
    const state = this.state(ctx);

    if (!state.type) {
      await ctx.reply('Сначала выбери аудиторию.');
      return;
    }
    if (state.type === UserMailingType.USER && !state.userId) {
      await ctx.reply('Не задан telegram ID получателя.');
      return;
    }
    if (state.type === UserMailingType.GROUP && !state.groupId) {
      await ctx.reply('Не выбран канал/группа.');
      return;
    }
    if (!state.text && !state.imageFile) {
      await ctx.reply('Нужен хотя бы текст или картинка.');
      return;
    }

    let count: number;
    try {
      count = await this.usersMailingService.previewRecipients({
        type: state.type,
        userId: state.userId,
        groupId: state.groupId,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        await ctx.reply('Пользователь с таким telegram ID не найден.');
        return;
      }
      this.logger.error(
        { err: error },
        'mailing-create-wizard: не удалось посчитать получателей',
      );
      await ctx.reply('Не удалось посчитать получателей, попробуй ещё раз.');
      return;
    }

    if (count === 0) {
      await ctx.reply(
        'Получателей не нашлось (0 человек) — отправлять некому.',
      );
      return;
    }

    await this.deleteLastPrompt(ctx);
    const message = await ctx.reply(
      `⚠️ Получателей: <b>${count}</b>. Разослать реально этим людям?`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Да, отправить', 'send:confirm')],
          [Markup.button.callback('❌ Отмена', 'send:cancel')],
        ]),
      },
    );
    this.state(ctx).lastPromptMessageId = message.message_id;
  }

  private async handleSendConfirmation(
    ctx: WizardContext,
    value: string,
  ): Promise<void> {
    if (value === 'cancel') {
      await ctx.answerCbQuery('Не отправлено');
      await this.deleteLastPrompt(ctx);
      return;
    }

    if (value !== 'confirm') {
      await ctx.answerCbQuery();
      return;
    }

    await ctx.answerCbQuery('Отправляю…');
    const state = this.state(ctx);

    try {
      const result = await this.usersMailingService.sendMailing(
        {
          type: state.type as UserMailingType,
          userId: state.userId,
          groupId: state.groupId,
          text: state.text,
          buttonText: state.buttonText,
          buttonUrl: state.buttonUrl,
        },
        state.imageFile,
      );

      if (state.cardChatId && state.cardMessageId) {
        try {
          await ctx.telegram.deleteMessage(
            state.cardChatId,
            state.cardMessageId,
          );
        } catch (error) {
          this.logger.debug(
            { err: error },
            'mailing-create-wizard: не удалось удалить карточку после отправки',
          );
        }
      }

      await ctx.reply(
        `✅ Рассылка поставлена в очередь (id ${result.jobId}): получателей ${result.enqueuedCount}.`,
      );
      await ctx.scene.leave();
    } catch (error) {
      this.logger.error(
        { err: error },
        'mailing-create-wizard: не удалось отправить рассылку',
      );
      const message =
        error instanceof Error ? error.message : 'неизвестная ошибка';
      await ctx.reply(`Не удалось отправить рассылку: ${message}`);
    }
  }

  // ── общие хелперы полей ──────────────────────────────────────────────────

  private async promptField(
    ctx: WizardContext,
    field: AwaitingField,
    text: string,
  ): Promise<void> {
    await this.deleteLastPrompt(ctx);
    const message = await ctx.reply(text);
    const state = this.state(ctx);
    state.awaitingField = field;
    state.lastPromptMessageId = message.message_id;
  }

  private async finishAnswer(ctx: WizardContext): Promise<void> {
    const state = this.state(ctx);
    state.awaitingField = undefined;
    await this.deleteLastPrompt(ctx);
    await this.renderCard(ctx);
  }

  private async deleteLastPrompt(ctx: WizardContext): Promise<void> {
    const state = this.state(ctx);
    if (!state.lastPromptMessageId || !state.cardChatId) return;
    try {
      await ctx.telegram.deleteMessage(
        state.cardChatId,
        state.lastPromptMessageId,
      );
    } catch {
      // Сообщение могли уже удалить вручную — не критично.
    }
    state.lastPromptMessageId = undefined;
  }

  private readText(ctx: WizardContext): string | undefined {
    const message = ctx.message;
    if (!message || !('text' in message)) return undefined;
    return message.text.trim();
  }

  private readRawText(ctx: WizardContext): string | undefined {
    const message = ctx.message;
    if (!message || !('text' in message)) return undefined;
    return message.text;
  }

  private readCustomEmojiEntities(
    ctx: WizardContext,
  ): CustomEmojiEntity[] | undefined {
    const message = ctx.message;
    if (!message || !('entities' in message)) return undefined;
    return extractCustomEmojiEntities(message.entities);
  }

  private isValidUrl(text: string): boolean {
    try {
      const url = new URL(text);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  // ── карточка ─────────────────────────────────────────────────────────────

  private buildCardText(state: MailingCreateWizardState): string {
    const line = (label: string, value: string | undefined) =>
      `${value ? '✅' : '▫️'} <b>${label}:</b> ${value ?? 'не задано'}`;

    const audienceValue = !state.type
      ? undefined
      : state.type === UserMailingType.USER
        ? `${AUDIENCE_LABELS[state.type]} (${state.userId ?? '?'})`
        : state.type === UserMailingType.GROUP
          ? `${AUDIENCE_LABELS[state.type]}: ${state.groupLabel ?? state.groupId}`
          : AUDIENCE_LABELS[state.type];

    return [
      '<b>📢 Новая рассылка</b>',
      '',
      line('Аудитория', audienceValue),
      line(
        'Текст',
        state.text
          ? renderTextWithCustomEmoji(state.text, state.textEntities)
          : undefined,
      ),
      line('Картинка', state.imageFile ? 'прикреплена' : undefined),
      line(
        'Кнопка',
        state.buttonText && state.buttonUrl
          ? `«${escapeHtml(state.buttonText)}» → ${state.buttonUrl}`
          : undefined,
      ),
    ].join('\n');
  }

  private buildCardKeyboard() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🎯 Аудитория', 'card:audience')],
      [
        Markup.button.callback('📝 Текст', 'card:text'),
        Markup.button.callback('🖼 Картинка', 'card:image'),
      ],
      [Markup.button.callback('🔘 Кнопка', 'card:button')],
      [Markup.button.callback('👁 Превью', 'card:preview')],
      [
        Markup.button.callback('✅ Отправить', 'card:send'),
        Markup.button.callback('❌ Отмена', 'card:cancel'),
      ],
    ]);
  }

  private async renderCard(ctx: WizardContext): Promise<void> {
    const state = this.state(ctx);
    if (!state.cardChatId || !state.cardMessageId) return;

    try {
      await ctx.telegram.editMessageText(
        state.cardChatId,
        state.cardMessageId,
        undefined,
        this.buildCardText(state),
        {
          parse_mode: 'HTML',
          reply_markup: this.buildCardKeyboard().reply_markup,
        },
      );
    } catch (error) {
      this.logger.debug(
        { err: error },
        'mailing-create-wizard: editMessageText (карточка)',
      );
    }
  }

  // ── превью сообщения ─────────────────────────────────────────────────────

  private async sendPreview(ctx: WizardContext): Promise<void> {
    const state = this.state(ctx);

    if (!state.text && !state.imageFile) {
      await ctx.reply('Сначала укажи текст или картинку.');
      return;
    }

    const text = state.text
      ? renderTextWithCustomEmoji(state.text, state.textEntities)
      : '';

    const replyMarkup: InlineKeyboardMarkup = {
      inline_keyboard: [
        ...(state.buttonText && state.buttonUrl
          ? [[{ text: state.buttonText, url: state.buttonUrl }]]
          : []),
        [{ text: '✖ Закрыть', callback_data: 'preview:close' }],
      ],
    };

    if (state.imageFile) {
      await ctx.replyWithPhoto(
        { source: state.imageFile.path },
        { caption: text, parse_mode: 'HTML', reply_markup: replyMarkup },
      );
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: replyMarkup });
    }
  }
}
