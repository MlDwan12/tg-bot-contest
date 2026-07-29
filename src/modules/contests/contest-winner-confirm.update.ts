import { Action, Ctx, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { Logger } from 'nestjs-pino';
import {
  ConfirmationOutcome,
  ContestWinnerConfirmationService,
} from './services/contest-winner-confirmation.service';

/**
 * Кнопки «Подтвердить»/«Отказаться» под личным уведомлением победителя.
 *
 * Живёт в модуле конкурсов, а НЕ в bot: тот объявлен листом графа, и цикл
 * bot↔contests в проекте разрывали намеренно. Связь contests→bot односторонняя
 * и уже существует, поэтому обработчик здесь ничего не ломает.
 */
export const WINNER_CONFIRM_PREFIX = 'winner_confirm';
export const WINNER_DECLINE_PREFIX = 'winner_decline';

/** callback_data ограничен 64 байтами, поэтому в кнопку кладём только id строки. */
export function buildConfirmCallbackData(winnerId: number): string {
  return `${WINNER_CONFIRM_PREFIX}:${winnerId}`;
}

export function buildDeclineCallbackData(winnerId: number): string {
  return `${WINNER_DECLINE_PREFIX}:${winnerId}`;
}

const OUTCOME_TEXT: Record<ConfirmationOutcome, string> = {
  confirmed: '✅ Приз подтверждён! С вами свяжется организатор.',
  declined: '❌ Вы отказались от приза. Он перейдёт следующему участнику.',
  already_resolved: 'Вы уже принимали решение по этому призу.',
  expired: '⌛ Срок подтверждения истёк, приз перешёл следующему участнику.',
  not_found: 'Приз не найден — возможно, конкурс удалён.',
  foreign: 'Эта кнопка не для вас.',
};

@Update()
export class ContestWinnerConfirmUpdate {
  constructor(
    private readonly confirmationService: ContestWinnerConfirmationService,
    private readonly logger: Logger,
  ) {}

  @Action(new RegExp(`^${WINNER_CONFIRM_PREFIX}:(\\d+)$`))
  async onConfirm(@Ctx() ctx: Context): Promise<void> {
    await this.handle(ctx, true);
  }

  @Action(new RegExp(`^${WINNER_DECLINE_PREFIX}:(\\d+)$`))
  async onDecline(@Ctx() ctx: Context): Promise<void> {
    await this.handle(ctx, false);
  }

  private async handle(ctx: Context, accepted: boolean): Promise<void> {
    const winnerId = this.extractWinnerId(ctx);
    const fromTelegramId = ctx.from?.id;

    if (winnerId === null || fromTelegramId === undefined) {
      await this.answer(ctx, 'Не удалось обработать нажатие.');
      return;
    }

    const outcome = accepted
      ? await this.confirmationService.confirm(winnerId, String(fromTelegramId))
      : await this.confirmationService.decline(
          winnerId,
          String(fromTelegramId),
        );

    await this.answer(ctx, OUTCOME_TEXT[outcome]);

    // Кнопки убираем, когда решение принято или принимать его поздно: иначе
    // победитель жмёт по уже неактуальному сообщению и каждый раз получает
    // отказ. При 'foreign' сообщение чужое — не трогаем вовсе.
    if (outcome !== 'foreign') {
      await this.removeButtons(ctx);
    }
  }

  private extractWinnerId(ctx: Context): number | null {
    const query = ctx.callbackQuery;
    const data =
      query && 'data' in query ? (query.data as string | undefined) : undefined;

    const match = data?.match(/:(\d+)$/);

    return match ? Number(match[1]) : null;
  }

  /**
   * Ответ на callback обязателен: без него у пользователя висит «часики» на
   * кнопке. Сбой ответа не должен ронять обработку — решение уже записано.
   */
  private async answer(ctx: Context, text: string): Promise<void> {
    try {
      await ctx.answerCbQuery(text, { show_alert: true });
    } catch (error) {
      this.logger.warn(
        { err: error },
        'winner-confirm: не удалось ответить на callback',
      );
    }
  }

  private async removeButtons(ctx: Context): Promise<void> {
    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch (error) {
      // Сообщение могло быть удалено пользователем, а разметка — уже снята
      // прошлым нажатием. Для нас это не ошибка.
      this.logger.debug(
        { err: error },
        'winner-confirm: не удалось убрать кнопки',
      );
    }
  }
}
