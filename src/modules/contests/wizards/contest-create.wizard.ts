import { Ctx, Wizard, WizardStep, Command } from 'nestjs-telegraf';
import { Markup, Scenes } from 'telegraf';
import { InlineKeyboardMarkup } from '@telegraf/types';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { WinnerStrategy } from 'src/common/enums/contest';
import { ChannelPlatform } from 'src/common/enums/channel';
import { ChannelsService } from 'src/modules/channels/services';
import { escapeHtml } from '../services/contest-results-text.util';
import { ContestsService } from '../services/contests.service';
import { buildContestPostPayload } from '../services/contest-post-payload.util';
import { downloadTelegramPhotoAsContestImage } from './download-telegram-photo.helper';
import {
  CustomEmojiEntity,
  renderTextWithCustomEmoji,
  extractCustomEmojiEntities,
} from './custom-emoji.util';

export const CONTEST_CREATE_SCENE_ID = 'contest-create';

const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];
const WEEKDAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Поле, ответ на которое сейчас ждём обычным текстовым/фото-сообщением.
 * Всё, что решается кнопками (стратегия, да/нет, выбор канала, календарь),
 * в этом состоянии не нуждается — там дальше решает callback_data. */
type AwaitingField = 'name' | 'description' | 'image' | 'buttonText';

interface ContestCreateWizardState {
  creatorId: number;
  name?: string;
  description?: string;
  imageFile?: Express.Multer.File;
  winnerStrategy?: WinnerStrategy;
  prizePlaces?: number;
  startDate?: Date;
  endDate?: Date;
  publishChannelExternalIds: string[];
  requiredChannelExternalIds: string[];
  buttonText?: string;
  requireWinnerConfirmation?: boolean;
  confirmationHours?: number;
  activeChannels?: Array<{ externalId: string; label: string }>;

  /** Карточка-панель — одно сообщение, которое редактируется на месте. */
  cardChatId?: number;
  cardMessageId?: number;
  /** Поле, ответ на которое сейчас ждём (см. AwaitingField). */
  awaitingField?: AwaitingField;
  /** Сообщение-вопрос бота — удаляем после ответа, чтобы не копить историю. */
  lastPromptMessageId?: number;
  /** Открытая клавиатура выбора каналов — тоже удаляем по «Готово». */
  channelPickerMessageId?: number;
  channelPickerTarget?: 'publishChannels' | 'requiredChannels';

  /** Кастомные (анимированные) эмодзи из исходных сообщений — только для
   * рендера в диалоге с ботом, см. renderTextWithCustomEmoji. */
  nameEntities?: CustomEmojiEntity[];
  descriptionEntities?: CustomEmojiEntity[];
  buttonTextEntities?: CustomEmojiEntity[];

  /** Календарь дат — какое поле сейчас выбираем и что уже выбрано. */
  calendarTarget?: 'start' | 'end';
  calendarStage?: 'day' | 'time';
  calendarYear?: number;
  calendarMonth?: number;
  calendarDay?: number;
  calendarHour?: number;
  calendarMinute?: number;
}

type WizardContext = Scenes.WizardContext;

/**
 * Диалог создания конкурса прямо из чата с ботом — альтернатива форме в
 * мини-аппе (админ-панели), для случаев, когда фронт ещё не готов (см.
 * CONTEST_FEATURES_PLAN.md). Живёт в модуле contests, а не bot: тот лист
 * графа зависимостей, ему нельзя знать про ContestsService/ChannelsService.
 *
 * Модель — одна карточка-панель (редактируется на месте), а не линейная
 * цепочка вопросов: поля заполняются в любом порядке, каждый ответ сразу
 * виден в той же карточке. В конце вызывает тот же ContestsService.createContest,
 * что и HTTP-путь — бизнес-правила не дублируются.
 */
@Wizard(CONTEST_CREATE_SCENE_ID)
export class ContestCreateWizard {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly channelsService: ChannelsService,
    private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) {}

  /** Работает на любом шаге сцены — выход без создания конкурса. */
  @Command('cancel')
  async cancel(@Ctx() ctx: WizardContext): Promise<void> {
    await ctx.reply('Создание конкурса отменено.');
    await ctx.scene.leave();
  }

  private state(ctx: WizardContext): ContestCreateWizardState {
    return ctx.wizard.state as ContestCreateWizardState;
  }

  @WizardStep(0)
  async stepEnter(@Ctx() ctx: WizardContext): Promise<void> {
    const channels = await this.channelsService.getActiveChannels();
    this.state(ctx).activeChannels = channels
      .filter(
        (c) => c.platform === ChannelPlatform.TELEGRAM && c.externalId != null,
      )
      .map((c) => ({
        externalId: c.externalId as string,
        label: c.name ?? c.externalUsername ?? (c.externalId as string),
      }));

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

    if (data.startsWith('strategy:')) {
      const value = data.slice('strategy:'.length);
      this.state(ctx).winnerStrategy =
        value === 'random' ? WinnerStrategy.RANDOM : WinnerStrategy.MANUAL;
      // Тост — единственная гарантированная обратная связь: если значение не
      // меняется (повторное нажатие), карточка выглядит идентично, и без
      // тоста кажется, что кнопка не сработала.
      await ctx.answerCbQuery(
        value === 'random' ? 'Случайный розыгрыш' : 'Ручной выбор',
      );
      await this.deleteLastPrompt(ctx);
      await this.renderCard(ctx);
      return;
    }

    if (data.startsWith('confirm:')) {
      const value = data.slice('confirm:'.length);
      if (value === 'no') {
        this.state(ctx).requireWinnerConfirmation = false;
        this.state(ctx).confirmationHours = undefined;
        await ctx.answerCbQuery('Подтверждение приза: нет');
        await this.deleteLastPrompt(ctx);
        await this.renderCard(ctx);
        return;
      }
      this.state(ctx).requireWinnerConfirmation = true;
      await ctx.answerCbQuery('Подтверждение приза: да');
      await this.openStepper(
        ctx,
        'ch',
        this.state(ctx).confirmationHours ?? 24,
      );
      return;
    }

    if (data.startsWith('chpick:')) {
      await this.handleChannelPickerTap(ctx, data.slice('chpick:'.length));
      return;
    }

    if (data.startsWith('pp:') || data.startsWith('ch:')) {
      await this.handleStepperTap(ctx, data);
      return;
    }

    if (data.startsWith('cal:')) {
      await this.handleCalendarTap(ctx, data.slice('cal:'.length));
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
            'contest-create-wizard: не удалось удалить превью',
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
      case 'name':
        await this.promptField(ctx, 'name', 'Название конкурса?');
        return;
      case 'description':
        await this.promptField(
          ctx,
          'description',
          'Описание конкурса? (или «-», чтобы очистить)',
        );
        return;
      case 'image':
        await this.promptField(
          ctx,
          'image',
          'Пришли картинку конкурса (фото) или «-», чтобы убрать.',
        );
        return;
      case 'strategy': {
        await this.deleteLastPrompt(ctx);
        const message = await ctx.reply(
          'Тип розыгрыша:',
          Markup.inlineKeyboard([
            [Markup.button.callback('Случайный', 'strategy:random')],
            [Markup.button.callback('Ручной', 'strategy:manual')],
          ]),
        );
        this.state(ctx).lastPromptMessageId = message.message_id;
        return;
      }
      case 'prizePlaces':
        await this.openStepper(ctx, 'pp', this.state(ctx).prizePlaces ?? 1);
        return;
      case 'dates':
        await this.openCalendar(ctx, 'start');
        return;
      case 'publishChannels':
        await this.openChannelPicker(
          ctx,
          'Каналы публикации (выбери один или несколько, потом «Готово»):',
          'publishChannels',
        );
        return;
      case 'requiredChannels':
        await this.openChannelPicker(
          ctx,
          'Обязательные для участия каналы (или «Готово» без выбора):',
          'requiredChannels',
        );
        return;
      case 'buttonText':
        await this.promptField(
          ctx,
          'buttonText',
          'Текст кнопки? (или «-» — по умолчанию «Участвовать»)',
        );
        return;
      case 'confirmation': {
        await this.deleteLastPrompt(ctx);
        const message = await ctx.reply(
          'Требовать от победителя подтверждение приза (с автодобором при отказе)?',
          Markup.inlineKeyboard([
            [Markup.button.callback('Да', 'confirm:yes')],
            [Markup.button.callback('Нет', 'confirm:no')],
          ]),
        );
        this.state(ctx).lastPromptMessageId = message.message_id;
        return;
      }
      case 'preview':
        await this.sendPostPreview(ctx);
        return;
      case 'create':
        await this.createContest(ctx);
        return;
      case 'cancel':
        await ctx.reply('Создание конкурса отменено.');
        await ctx.scene.leave();
        return;
      default:
        this.logger.warn(
          { key },
          'contest-create-wizard: неизвестная кнопка карточки',
        );
    }
  }

  private async handleAnswer(ctx: WizardContext): Promise<void> {
    const state = this.state(ctx);
    const field = state.awaitingField;
    if (!field) {
      // Раньше молча игнорировали — выглядело как зависший бот, если человек
      // печатал текст вместо нажатия кнопки на карточке/клавиатуре.
      await ctx.reply(
        'Нажми одну из кнопок на карточке выше ⬆️ (или /cancel, чтобы выйти).',
      );
      return;
    }

    switch (field) {
      case 'name': {
        const entities = this.readCustomEmojiEntities(ctx);
        const raw = this.readRawText(ctx);
        const text = entities ? raw : raw?.trim();
        if (!text || text.length > 255) {
          await ctx.reply(
            'Название не должно быть пустым и длиннее 255 символов. Повтори:',
          );
          return;
        }
        state.name = text;
        state.nameEntities = entities;
        await this.finishAnswer(ctx);
        return;
      }
      case 'description': {
        const entities = this.readCustomEmojiEntities(ctx);
        const raw = this.readRawText(ctx);
        const text = entities ? raw : raw?.trim();
        if (text === undefined) {
          await ctx.reply('Пришли текст описания или «-», чтобы очистить.');
          return;
        }
        state.description = text === '-' ? undefined : text;
        state.descriptionEntities = text === '-' ? undefined : entities;
        await this.finishAnswer(ctx);
        return;
      }
      case 'image': {
        const message = ctx.message;
        if (message && 'photo' in message && message.photo.length) {
          try {
            const largest = message.photo[message.photo.length - 1];
            const fileUrl = await ctx.telegram.getFileLink(largest.file_id);
            state.imageFile = await downloadTelegramPhotoAsContestImage(
              fileUrl.href,
            );
          } catch (error) {
            this.logger.warn(
              { err: error },
              'contest-create-wizard: не удалось скачать картинку из Telegram',
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
        const entities = this.readCustomEmojiEntities(ctx);
        const raw = this.readRawText(ctx);
        const text = entities ? raw : raw?.trim();
        if (text === undefined) {
          await ctx.reply('Пришли текст кнопки или «-».');
          return;
        }
        state.buttonText = text === '-' ? undefined : text;
        state.buttonTextEntities = text === '-' ? undefined : entities;
        await this.finishAnswer(ctx);
        return;
      }
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

  /** Числовые поля (места, срок подтверждения) — кнопки +/− вместо ввода
   * текста: не оставляют сообщений пользователя в чате (их всё равно нельзя
   * удалить программно — ограничение Bot API — а кнопки просто не создают
   * новых сообщений от имени пользователя). */
  private stepperConfig(prefix: 'pp' | 'ch') {
    return prefix === 'pp'
      ? { label: 'Призовых мест', min: 1, max: 1000, steps: [1] }
      : {
          label: 'Срок подтверждения (часов)',
          min: 1,
          max: 168,
          steps: [1, 10],
        };
  }

  private buildStepperKeyboard(
    prefix: 'pp' | 'ch',
    value: number,
    steps: number[],
  ) {
    const decRow = [...steps]
      .reverse()
      .map((s) => Markup.button.callback(`−${s}`, `${prefix}:dec:${s}`));
    const incRow = steps.map((s) =>
      Markup.button.callback(`+${s}`, `${prefix}:inc:${s}`),
    );
    return Markup.inlineKeyboard([
      [Markup.button.callback(`${value}`, `${prefix}:noop`)],
      decRow,
      incRow,
      [Markup.button.callback('✅ Готово', `${prefix}:done`)],
    ]);
  }

  private async openStepper(
    ctx: WizardContext,
    prefix: 'pp' | 'ch',
    initialValue: number,
  ): Promise<void> {
    await this.deleteLastPrompt(ctx);
    const state = this.state(ctx);
    if (prefix === 'pp') state.prizePlaces = initialValue;
    else state.confirmationHours = initialValue;

    const { label, steps } = this.stepperConfig(prefix);
    const message = await ctx.reply(
      `${label}: ${initialValue}`,
      this.buildStepperKeyboard(prefix, initialValue, steps),
    );
    state.lastPromptMessageId = message.message_id;
  }

  private async handleStepperTap(
    ctx: WizardContext,
    data: string,
  ): Promise<void> {
    const [prefixRaw, action, stepStr] = data.split(':');
    const prefix = prefixRaw as 'pp' | 'ch';
    const { label, min, max, steps } = this.stepperConfig(prefix);
    const state = this.state(ctx);

    if (action === 'noop') {
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'done') {
      await ctx.answerCbQuery('Сохранено');
      await this.deleteLastPrompt(ctx);
      await this.renderCard(ctx);
      return;
    }

    const current =
      (prefix === 'pp' ? state.prizePlaces : state.confirmationHours) ?? min;
    const step = Number(stepStr) || 1;
    const next = Math.min(
      max,
      Math.max(min, current + (action === 'inc' ? step : -step)),
    );

    if (prefix === 'pp') state.prizePlaces = next;
    else state.confirmationHours = next;

    await ctx.answerCbQuery(`${next}`);

    try {
      await ctx.editMessageText(
        `${label}: ${next}`,
        this.buildStepperKeyboard(prefix, next, steps),
      );
    } catch (error) {
      this.logger.debug(
        { err: error },
        'contest-create-wizard: editMessageText (степпер)',
      );
    }
  }

  /** Поле получено и провалидировано — убираем вопрос бота и обновляем карточку. */
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

  /** Без trim: у entities offset/length считаны от исходной строки, обрезка
   * сдвинула бы их. Использовать вместе с readCustomEmojiEntities. */
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

  // ── календарь (даты начала/окончания, кнопками) ─────────────────────────

  /** Сетка дней месяца. UTC-геттеры дают Date с теми же числами, что и
   * ISO-строка с "Z" в HTTP-пути — дальше fromZonedTime внутри ContestsService
   * трактует их как московское время, без привязки к таймзоне сервера. */
  private buildCalendarKeyboard(year: number, month: number) {
    const firstWeekday =
      (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    const header = [
      Markup.button.callback('◀️', 'cal:nav:prev'),
      Markup.button.callback(`${MONTH_NAMES[month]} ${year}`, 'cal:noop'),
      Markup.button.callback('▶️', 'cal:nav:next'),
    ];
    const weekdayRow = WEEKDAY_NAMES.map((d) =>
      Markup.button.callback(d, 'cal:noop'),
    );

    const rows: ReturnType<typeof Markup.button.callback>[][] = [
      header,
      weekdayRow,
    ];
    let row: ReturnType<typeof Markup.button.callback>[] = [];
    for (let i = 0; i < firstWeekday; i++) {
      row.push(Markup.button.callback(' ', 'cal:noop'));
    }
    for (let day = 1; day <= daysInMonth; day++) {
      row.push(Markup.button.callback(`${day}`, `cal:day:${day}`));
      if (row.length === 7) {
        rows.push(row);
        row = [];
      }
    }
    if (row.length) {
      while (row.length < 7) row.push(Markup.button.callback(' ', 'cal:noop'));
      rows.push(row);
    }
    rows.push([Markup.button.callback('❌ Отмена', 'cal:cancel')]);

    return Markup.inlineKeyboard(rows);
  }

  private buildCalendarTimeKeyboard(hour: number, minute: number) {
    return Markup.inlineKeyboard([
      [Markup.button.callback(`${pad2(hour)}:${pad2(minute)}`, 'cal:noop')],
      [
        Markup.button.callback('−1ч', 'cal:h:dec'),
        Markup.button.callback('+1ч', 'cal:h:inc'),
        Markup.button.callback('−15м', 'cal:m:dec'),
        Markup.button.callback('+15м', 'cal:m:inc'),
      ],
      [Markup.button.callback('✅ Готово', 'cal:time:done')],
      [Markup.button.callback('❌ Отмена', 'cal:cancel')],
    ]);
  }

  private async openCalendar(
    ctx: WizardContext,
    target: 'start' | 'end',
  ): Promise<void> {
    await this.deleteLastPrompt(ctx);
    const state = this.state(ctx);
    const now = new Date();

    state.calendarTarget = target;
    state.calendarStage = 'day';
    state.calendarYear = state.calendarYear ?? now.getUTCFullYear();
    state.calendarMonth = state.calendarMonth ?? now.getUTCMonth();
    state.calendarDay = undefined;
    state.calendarHour = state.calendarHour ?? 12;
    state.calendarMinute = state.calendarMinute ?? 0;

    const label = target === 'start' ? 'Дата начала:' : 'Дата окончания:';
    const message = await ctx.reply(
      label,
      this.buildCalendarKeyboard(state.calendarYear, state.calendarMonth),
    );
    state.lastPromptMessageId = message.message_id;
  }

  private async handleCalendarTap(
    ctx: WizardContext,
    action: string,
  ): Promise<void> {
    const state = this.state(ctx);

    if (action === 'noop') {
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'cancel') {
      await ctx.answerCbQuery('Отменено');
      state.calendarTarget = undefined;
      state.calendarStage = undefined;
      await this.deleteLastPrompt(ctx);
      await this.renderCard(ctx);
      return;
    }

    if (action.startsWith('nav:')) {
      let year = state.calendarYear ?? new Date().getUTCFullYear();
      let month = state.calendarMonth ?? new Date().getUTCMonth();
      month += action === 'nav:next' ? 1 : -1;
      if (month < 0) {
        month = 11;
        year -= 1;
      } else if (month > 11) {
        month = 0;
        year += 1;
      }
      state.calendarYear = year;
      state.calendarMonth = month;
      await ctx.answerCbQuery();
      try {
        await ctx.editMessageReplyMarkup(
          this.buildCalendarKeyboard(year, month).reply_markup,
        );
      } catch (error) {
        this.logger.debug(
          { err: error },
          'contest-create-wizard: editMessageReplyMarkup (календарь)',
        );
      }
      return;
    }

    if (action.startsWith('day:')) {
      state.calendarDay = Number(action.slice('day:'.length));
      state.calendarStage = 'time';
      await ctx.answerCbQuery();
      const hour = state.calendarHour ?? 12;
      const minute = state.calendarMinute ?? 0;
      try {
        await ctx.editMessageText(
          `Время (${pad2(state.calendarDay)}.${pad2((state.calendarMonth ?? 0) + 1)}.${state.calendarYear}):`,
          this.buildCalendarTimeKeyboard(hour, minute),
        );
      } catch (error) {
        this.logger.debug(
          { err: error },
          'contest-create-wizard: editMessageText (время)',
        );
      }
      return;
    }

    if (action === 'h:inc' || action === 'h:dec') {
      const hour = state.calendarHour ?? 12;
      state.calendarHour = (hour + (action === 'h:inc' ? 1 : -1) + 24) % 24;
      await ctx.answerCbQuery(
        `${pad2(state.calendarHour)}:${pad2(state.calendarMinute ?? 0)}`,
      );
      await this.rerenderCalendarTime(ctx);
      return;
    }

    if (action === 'm:inc' || action === 'm:dec') {
      const minute = state.calendarMinute ?? 0;
      state.calendarMinute =
        (minute + (action === 'm:inc' ? 15 : -15) + 60) % 60;
      await ctx.answerCbQuery(
        `${pad2(state.calendarHour ?? 12)}:${pad2(state.calendarMinute)}`,
      );
      await this.rerenderCalendarTime(ctx);
      return;
    }

    if (action === 'time:done') {
      await ctx.answerCbQuery();
      await this.finalizeCalendarDate(ctx);
      return;
    }
  }

  private async rerenderCalendarTime(ctx: WizardContext): Promise<void> {
    const state = this.state(ctx);
    try {
      await ctx.editMessageReplyMarkup(
        this.buildCalendarTimeKeyboard(
          state.calendarHour ?? 12,
          state.calendarMinute ?? 0,
        ).reply_markup,
      );
    } catch (error) {
      this.logger.debug(
        { err: error },
        'contest-create-wizard: editMessageReplyMarkup (время)',
      );
    }
  }

  private async finalizeCalendarDate(ctx: WizardContext): Promise<void> {
    const state = this.state(ctx);
    const { calendarYear, calendarMonth, calendarDay, calendarTarget } = state;

    if (
      calendarYear === undefined ||
      calendarMonth === undefined ||
      calendarDay === undefined
    ) {
      return;
    }

    const date = new Date(
      Date.UTC(
        calendarYear,
        calendarMonth,
        calendarDay,
        state.calendarHour ?? 12,
        state.calendarMinute ?? 0,
      ),
    );

    if (calendarTarget === 'start') {
      state.startDate = date;
      await this.openCalendar(ctx, 'end');
      return;
    }

    state.endDate = date;
    state.calendarTarget = undefined;
    state.calendarStage = undefined;
    await this.deleteLastPrompt(ctx);
    await this.renderCard(ctx);
  }

  // ── выбор каналов (множественный, кнопками) ─────────────────────────────

  private buildChannelKeyboard(
    channels: Array<{ externalId: string; label: string }>,
    selected: string[],
  ) {
    const buttons = channels.map((channel) => [
      Markup.button.callback(
        `${selected.includes(channel.externalId) ? '✅ ' : ''}${channel.label}`,
        `chpick:${channel.externalId}`,
      ),
    ]);
    buttons.push([Markup.button.callback('Готово', 'chpick:done')]);
    return Markup.inlineKeyboard(buttons);
  }

  private selectedChannels(
    state: ContestCreateWizardState,
    target: 'publishChannels' | 'requiredChannels',
  ): string[] {
    return target === 'publishChannels'
      ? state.publishChannelExternalIds
      : state.requiredChannelExternalIds;
  }

  private async openChannelPicker(
    ctx: WizardContext,
    prompt: string,
    target: 'publishChannels' | 'requiredChannels',
  ): Promise<void> {
    const state = this.state(ctx);
    const message = await ctx.reply(
      prompt,
      this.buildChannelKeyboard(
        state.activeChannels ?? [],
        this.selectedChannels(state, target),
      ),
    );
    state.channelPickerMessageId = message.message_id;
    state.channelPickerTarget = target;
  }

  private async handleChannelPickerTap(
    ctx: WizardContext,
    value: string,
  ): Promise<void> {
    const state = this.state(ctx);
    const target = state.channelPickerTarget;

    if (!target) {
      await ctx.answerCbQuery();
      return;
    }

    const selected = this.selectedChannels(state, target);

    if (value === 'done') {
      await ctx.answerCbQuery();
      if (state.channelPickerMessageId && state.cardChatId) {
        try {
          await ctx.telegram.deleteMessage(
            state.cardChatId,
            state.channelPickerMessageId,
          );
        } catch {
          // не критично
        }
      }
      state.channelPickerMessageId = undefined;
      state.channelPickerTarget = undefined;
      await this.renderCard(ctx);
      return;
    }

    await ctx.answerCbQuery();
    const index = selected.indexOf(value);
    if (index === -1) {
      selected.push(value);
    } else {
      selected.splice(index, 1);
    }

    try {
      await ctx.editMessageReplyMarkup(
        this.buildChannelKeyboard(state.activeChannels ?? [], selected)
          .reply_markup,
      );
    } catch (error) {
      this.logger.debug(
        { err: error },
        'contest-create-wizard: editMessageReplyMarkup (channel picker)',
      );
    }
  }

  // ── карточка ─────────────────────────────────────────────────────────────

  private channelLabel(
    state: ContestCreateWizardState,
    externalId: string,
  ): string {
    return (
      state.activeChannels?.find((c) => c.externalId === externalId)?.label ??
      externalId
    );
  }

  /** Даты в состоянии — "носитель" МСК-чисел (см. finalizeCalendarDate): их
   * UTC-геттеры уже равны тому, что выбрал админ, и fromZonedTime внутри
   * ContestsService трактует их как московское время при создании. Поэтому
   * здесь читаем UTC-геттеры НАПРЯМУЮ, без пересчёта через таймзону — иначе
   * получится двойной сдвиг (карточка показывала бы +3 часа к выбранному). */
  private formatDate(state: ContestCreateWizardState, date?: Date): string {
    if (!date) return '—';
    return (
      `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}, ` +
      `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`
    );
  }

  private buildCardText(state: ContestCreateWizardState): string {
    // value уже HTML-safe (escapeHtml/renderTextWithCustomEmoji применены на
    // стороне вызова) — label здесь всегда наша же константа, экранировать не нужно.
    const line = (label: string, value: string | undefined) =>
      `${value ? '✅' : '▫️'} <b>${label}:</b> ${value ?? 'не задано'}`;

    const channelsLine = (ids: string[]) =>
      ids.length
        ? ids.map((id) => escapeHtml(this.channelLabel(state, id))).join(', ')
        : undefined;

    return [
      '<b>🎲 Новый конкурс</b>',
      '',
      line(
        'Название',
        state.name
          ? renderTextWithCustomEmoji(state.name, state.nameEntities)
          : undefined,
      ),
      line(
        'Описание',
        state.description
          ? renderTextWithCustomEmoji(
              state.description,
              state.descriptionEntities,
            )
          : undefined,
      ),
      line('Картинка', state.imageFile ? 'прикреплена' : undefined),
      line(
        'Тип розыгрыша',
        state.winnerStrategy === WinnerStrategy.RANDOM
          ? 'случайный'
          : state.winnerStrategy === WinnerStrategy.MANUAL
            ? 'ручной'
            : undefined,
      ),
      line('Призовых мест', state.prizePlaces?.toString()),
      line(
        'Даты',
        state.startDate && state.endDate
          ? `${this.formatDate(state, state.startDate)} — ${this.formatDate(state, state.endDate)}`
          : undefined,
      ),
      line('Каналы публикации', channelsLine(state.publishChannelExternalIds)),
      line(
        'Обязательные каналы',
        channelsLine(state.requiredChannelExternalIds),
      ),
      line(
        'Текст кнопки',
        renderTextWithCustomEmoji(
          state.buttonText ?? 'Участвовать',
          state.buttonText ? state.buttonTextEntities : undefined,
        ),
      ),
      line(
        'Подтверждение приза',
        state.requireWinnerConfirmation === undefined
          ? undefined
          : state.requireWinnerConfirmation
            ? `да, ${state.confirmationHours ?? '?'} ч.`
            : 'нет',
      ),
    ].join('\n');
  }

  private buildCardKeyboard() {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('📝 Название', 'card:name'),
        Markup.button.callback('📄 Описание', 'card:description'),
      ],
      [
        Markup.button.callback('🖼 Картинка', 'card:image'),
        Markup.button.callback('🔘 Текст кнопки', 'card:buttonText'),
      ],
      [
        Markup.button.callback('🎯 Тип розыгрыша', 'card:strategy'),
        Markup.button.callback('🏆 Мест', 'card:prizePlaces'),
      ],
      [Markup.button.callback('🕒 Даты', 'card:dates')],
      [Markup.button.callback('📢 Каналы публикации', 'card:publishChannels')],
      [
        Markup.button.callback(
          '✅ Обязательные каналы',
          'card:requiredChannels',
        ),
      ],
      [Markup.button.callback('⏳ Подтверждение приза', 'card:confirmation')],
      [Markup.button.callback('👁 Превью поста', 'card:preview')],
      [
        Markup.button.callback('✅ Создать', 'card:create'),
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
      // Например, текст не изменился — Telegram считает это ошибкой, не критично.
      this.logger.debug(
        { err: error },
        'contest-create-wizard: editMessageText (карточка)',
      );
    }
  }

  // ── превью поста (точно как реальная публикация) ────────────────────────

  private async sendPostPreview(ctx: WizardContext): Promise<void> {
    const state = this.state(ctx);

    if (!state.name) {
      await ctx.reply('Сначала укажи хотя бы название.');
      return;
    }

    const miniAppUrl = this.configService.get<string>('MINI_APP_URL');
    const channelExternalId = state.publishChannelExternalIds[0];

    const payload = buildContestPostPayload({
      contestId: 0,
      channelTelegramId: channelExternalId ?? '0',
      name: state.name,
      description: state.description,
      buttonText: state.buttonText,
      imagePath: state.imageFile
        ? `/uploads/contests/${state.imageFile.filename}`
        : undefined,
      miniAppUrl,
    });

    // Текст строим сами (не payload.text) — только здесь сохраняем анимированные
    // эмодзи из исходных сообщений (tg-emoji entities). Кнопка тоже animated
    // эмодзи не поддерживает — Telegram не форматирует текст кнопок, поэтому
    // payload.buttonText берём как есть.
    const description = state.description
      ? `\n\n${renderTextWithCustomEmoji(state.description, state.descriptionEntities)}`
      : '';
    const text = `${renderTextWithCustomEmoji(state.name, state.nameEntities)}${description}`;

    const replyMarkup: InlineKeyboardMarkup = {
      inline_keyboard: [
        [{ text: payload.buttonText, url: payload.buttonUrl }],
        [{ text: '✖ Закрыть', callback_data: 'preview:close' }],
      ],
    };

    if (state.imageFile) {
      await ctx.replyWithPhoto(
        { source: state.imageFile.path },
        {
          caption: text,
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        },
      );
    } else {
      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      });
    }
  }

  // ── создание ─────────────────────────────────────────────────────────────

  private async createContest(ctx: WizardContext): Promise<void> {
    const s = this.state(ctx);

    if (
      !s.name ||
      !s.winnerStrategy ||
      !s.prizePlaces ||
      !s.startDate ||
      !s.endDate
    ) {
      await ctx.reply(
        'Не хватает обязательных полей (название, тип розыгрыша, места, даты) — заполни через кнопки карточки.',
      );
      return;
    }

    try {
      const contest = await this.contestsService.createContest(
        {
          name: s.name,
          description: s.description,
          winnerStrategy: s.winnerStrategy,
          prizePlaces: s.prizePlaces,
          startDate: s.startDate,
          endDate: s.endDate,
          creatorId: s.creatorId,
          publishChannelExternalIds: s.publishChannelExternalIds,
          requiredChannelExternalIds: s.requiredChannelExternalIds,
          buttonText: s.buttonText,
          requireWinnerConfirmation: s.requireWinnerConfirmation,
          confirmationHours: s.confirmationHours,
        },
        s.imageFile,
      );

      // Карточка с кнопками полей после успешного создания бессмысленна и
      // только путает (жать там уже нечего) — убираем её вместо того, чтобы
      // оставлять висеть в чате.
      if (s.cardChatId && s.cardMessageId) {
        try {
          await ctx.telegram.deleteMessage(s.cardChatId, s.cardMessageId);
        } catch (error) {
          this.logger.debug(
            { err: error },
            'contest-create-wizard: не удалось удалить карточку после создания',
          );
        }
      }

      await ctx.reply(
        `✅ Конкурс создан (id ${contest.id}): «${contest.name}».`,
      );
      await ctx.scene.leave();
    } catch (error) {
      this.logger.error(
        { err: error },
        'contest-create-wizard: не удалось создать конкурс',
      );
      const message =
        error instanceof Error ? error.message : 'неизвестная ошибка';
      await ctx.reply(`Не удалось создать конкурс: ${message}`);
    }
  }
}
