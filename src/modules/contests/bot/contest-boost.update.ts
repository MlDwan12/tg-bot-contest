import {
  BadRequestException,
  Inject,
  OnApplicationBootstrap,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { Action, Command, Ctx, InjectBot, Update } from 'nestjs-telegraf';
import { Context, Markup, Telegraf } from 'telegraf';
import { CONTEST_REPOSITORY } from 'src/common/constants';
import { getAdminTelegramIdsFromEnv } from 'src/common/helpers/admin-ids.helper';
import { ContestStatus } from 'src/common/enums/contest';
import type { IContestRepository } from '../interfaces';
import { ContestBoostService } from '../services/contest-boost.service';
import { BotAdminExceptionFilter, BotAdminGuard } from './bot-admin.guard';

// Белые списки: callback_data можно подделать, поэтому значения из неё
// принимаются только отсюда.
const COUNTS = [10, 20, 50];
// 0 = до конца конкурса
const PERIODS: Array<[minutes: number, label: string]> = [
  [60, '1ч'],
  [180, '3ч'],
  [360, '6ч'],
  [0, 'До конца'],
];

type MatchCtx = Context & { match: RegExpExecArray };

/**
 * Админ-панель накрутки счётчика на кнопке поста: /boost → конкурс → действия.
 * Доступ — BotAdminGuard на весь класс, ошибки — BotAdminExceptionFilter.
 */
@Update()
@UseGuards(BotAdminGuard)
@UseFilters(BotAdminExceptionFilter)
export class ContestBoostUpdate implements OnApplicationBootstrap {
  constructor(
    private readonly boostService: ContestBoostService,
    @Inject(CONTEST_REPOSITORY)
    private readonly contestRepo: IContestRepository,
    @InjectBot() private readonly bot: Telegraf,
    private readonly logger: Logger,
  ) {}

  /** /boost в меню команд — только в личных чатах админов из env. */
  onApplicationBootstrap() {
    for (const id of getAdminTelegramIdsFromEnv()) {
      this.bot.telegram
        .setMyCommands(
          [{ command: 'boost', description: 'Накрутка счётчика конкурса' }],
          { scope: { type: 'chat', chat_id: Number(id) } },
        )
        // Падает, если админ ещё ни разу не писал боту — не критично.
        .catch((err) =>
          this.logger.warn({ err, id }, 'setMyCommands для админа не удался'),
        );
    }
  }

  @Command('boost')
  async boost(@Ctx() ctx: Context) {
    const { text, keyboard } = await this.renderList();
    await ctx.reply(text, keyboard);
  }

  @Action('bst:list')
  async list(@Ctx() ctx: Context) {
    const { text, keyboard } = await this.renderList();
    await ctx.editMessageText(text, keyboard);
    await ctx.answerCbQuery();
  }

  @Action(/^bst:c:(\d+)$/)
  async card(@Ctx() ctx: MatchCtx) {
    await this.showCard(ctx, Number(ctx.match[1]));
    await ctx.answerCbQuery();
  }

  @Action(/^bst:n:(\d+):(\d+)$/)
  async addNow(@Ctx() ctx: MatchCtx) {
    const contestId = Number(ctx.match[1]);
    const count = this.allowedCount(ctx.match[2]);
    await this.boostService.addNow(contestId, count);
    await this.showCard(ctx, contestId);
    await ctx.answerCbQuery(`+${count} добавлено`);
  }

  @Action(/^bst:g:(\d+)$/)
  async chooseCount(@Ctx() ctx: MatchCtx) {
    const contestId = Number(ctx.match[1]);
    await ctx.editMessageText(
      'Сколько добавить постепенно?',
      Markup.inlineKeyboard([
        COUNTS.map((n) =>
          Markup.button.callback(`${n}`, `bst:gc:${contestId}:${n}`),
        ),
        [Markup.button.callback('← Назад', `bst:c:${contestId}`)],
      ]),
    );
    await ctx.answerCbQuery();
  }

  @Action(/^bst:gc:(\d+):(\d+)$/)
  async choosePeriod(@Ctx() ctx: MatchCtx) {
    const contestId = Number(ctx.match[1]);
    const count = this.allowedCount(ctx.match[2]);
    await ctx.editMessageText(
      `+${count} постепенно. За какое время?`,
      Markup.inlineKeyboard([
        PERIODS.map(([minutes, label]) =>
          Markup.button.callback(
            label,
            `bst:gp:${contestId}:${count}:${minutes}`,
          ),
        ),
        [Markup.button.callback('← Назад', `bst:g:${contestId}`)],
      ]),
    );
    await ctx.answerCbQuery();
  }

  @Action(/^bst:gp:(\d+):(\d+):(\d+)$/)
  async schedule(@Ctx() ctx: MatchCtx) {
    const contestId = Number(ctx.match[1]);
    const count = this.allowedCount(ctx.match[2]);
    const minutes = Number(ctx.match[3]);
    if (!PERIODS.some(([m]) => m === minutes)) {
      throw new BadRequestException('Недопустимый период');
    }

    const actual = await this.boostService.schedule(
      contestId,
      count,
      minutes || null,
    );
    await this.showCard(ctx, contestId);
    await ctx.answerCbQuery(`+${count} за ~${formatMinutes(actual)}`);
  }

  @Action(/^bst:s:(\d+)$/)
  async stop(@Ctx() ctx: MatchCtx) {
    const contestId = Number(ctx.match[1]);
    const removed = await this.boostService.stop(contestId);
    await this.showCard(ctx, contestId);
    await ctx.answerCbQuery(`Отменено задач: ${removed}`);
  }

  private async renderList() {
    const contests = await this.contestRepo.findByStatus(ContestStatus.ACTIVE);
    if (!contests.length) {
      return { text: 'Активных конкурсов нет.', keyboard: undefined };
    }
    return {
      text: 'Выберите конкурс:',
      keyboard: Markup.inlineKeyboard(
        contests.map((c) => [
          Markup.button.callback(`#${c.id} ${c.name}`, `bst:c:${c.id}`),
        ]),
      ),
    };
  }

  private async showCard(ctx: Context, contestId: number) {
    const { contest, real, bonus, pending } =
      await this.boostService.getStatus(contestId);

    const text = [
      `#${contest.id} ${contest.name}`,
      '',
      `Реальных участников: ${real}`,
      `Надбавка: ${bonus}`,
      `На кнопке: ${real + bonus}`,
      `В очереди на добавление: ${pending}`,
    ].join('\n');

    await ctx.editMessageText(
      text,
      Markup.inlineKeyboard([
        COUNTS.map((n) =>
          Markup.button.callback(`+${n} сразу`, `bst:n:${contestId}:${n}`),
        ),
        [Markup.button.callback('Постепенно…', `bst:g:${contestId}`)],
        [Markup.button.callback('Остановить накрутку', `bst:s:${contestId}`)],
        [Markup.button.callback('← К списку', 'bst:list')],
      ]),
    );
  }

  private allowedCount(raw: string): number {
    const count = Number(raw);
    if (!COUNTS.includes(count)) {
      throw new BadRequestException('Недопустимое количество');
    }
    return count;
  }
}

function formatMinutes(minutes: number): string {
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}ч ${minutes % 60}м`
    : `${minutes}м`;
}
