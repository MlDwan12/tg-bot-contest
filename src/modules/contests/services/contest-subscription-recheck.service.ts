import { forwardRef, Inject, Injectable } from '@nestjs/common';
import Bottleneck from 'bottleneck';
import { Logger } from 'nestjs-pino';
import {
  CONTEST_PARTICIPATE_REPOSITORY,
  CONTEST_REPOSITORY,
} from 'src/common/constants';
import type {
  IContestParticipationRepository,
  IContestRepository,
} from '../interfaces';
import { ParticipationSubscriptionStatus } from 'src/common/enums/contest';
import { TelegramService } from 'src/modules/bot/bot.service';

/**
 * Темп обращений к Telegram при перепроверке.
 *
 * Проверка одного участника — это по одному getChatMember на каждый
 * обязательный канал, и они уходят параллельно внутри checkUserInChannels.
 * Поэтому лимит выставлен по участникам с запасом: 3 одновременно и не чаще
 * чем раз в 100 мс → ~10 участников/сек, то есть ~20 запросов/сек при двух
 * каналах. Общий потолок Telegram (~30 rps) не выбирается полностью намеренно:
 * той же квотой пользуются публикации и рассылки.
 */
const subscriptionLimiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 100,
});

export interface RecheckResult {
  /** Перепроверка не требовалась (выключена, нет каналов, уже проводилась). */
  skipped: boolean;
  checked: number;
  unsubscribed: number;
}

@Injectable()
export class ContestSubscriptionRecheckService {
  constructor(
    @Inject(CONTEST_REPOSITORY)
    private readonly contestRepo: IContestRepository,

    @Inject(CONTEST_PARTICIPATE_REPOSITORY)
    private readonly contestParticipationRepo: IContestParticipationRepository,

    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,

    private readonly logger: Logger,
  ) {}

  /**
   * Нужна ли конкурсу перепроверка перед подведением итогов.
   * Отдельный предикат, потому что решение принимается в finishContestIdempotent
   * (под advisory lock), а сама проверка идёт отдельным джобом — долгая работа
   * под локом заблокировала бы завершение на минуты.
   */
  needsRecheck(contest: {
    recheckSubscriptionOnFinish: boolean;
    subscriptionsCheckedAt: Date | null;
  }): boolean {
    return (
      contest.recheckSubscriptionOnFinish && !contest.subscriptionsCheckedAt
    );
  }

  /**
   * Перепроверяет подписку всех участников и записывает итог.
   *
   * Отметку о проведённой проверке ставим в любом исходе, включая «проверять
   * нечего»: без неё finishContestIdempotent снова поставил бы джоб проверки и
   * конкурс зациклился бы, так и не завершившись.
   */
  /**
   * Подписка ОДНОГО участника. Нужна автодобору: кандидат мог отписаться уже
   * после финиша, а гонять перепроверку всего пула ради одного человека незачем.
   *
   * true, если проверять нечего — перепроверка у конкурса выключена, обязательных
   * каналов нет или у участника нет telegramId: доказать отписку мы не можем, а
   * лишать приза по недоказанному хуже, чем оставить.
   */
  async isUserStillSubscribed(
    contestId: number,
    userId: number,
  ): Promise<boolean> {
    const contest = await this.contestRepo.findByParams({ id: contestId });

    const channelIds = (contest?.requiredChannels ?? [])
      .map((channel) => channel.telegramId)
      .filter((id): id is number => id != null);

    if (!contest?.recheckSubscriptionOnFinish || !channelIds.length) {
      return true;
    }

    const participation = await this.contestParticipationRepo.findOneByParam({
      contestId,
      userId,
    });

    const telegramId = participation?.user?.telegramId;

    if (!telegramId) return true;

    const { passed } = await this.telegramService.checkUserInChannels(
      String(telegramId),
      channelIds,
    );

    return passed;
  }

  async recheckContestSubscriptions(contestId: number): Promise<RecheckResult> {
    const contest = await this.contestRepo.findByParams({ id: contestId });

    if (!contest) {
      this.logger.warn(
        { contestId },
        'recheckContestSubscriptions: конкурс не найден',
      );
      return { skipped: true, checked: 0, unsubscribed: 0 };
    }

    const channelIds = (contest.requiredChannels ?? [])
      .map((channel) => channel.telegramId)
      .filter((id): id is number => id != null);

    if (!contest.recheckSubscriptionOnFinish || !channelIds.length) {
      await this.markContestChecked(contestId);
      return { skipped: true, checked: 0, unsubscribed: 0 };
    }

    const participants =
      await this.contestParticipationRepo.findManyByContestId(contestId);

    const valid: number[] = [];
    const unsubscribed: number[] = [];

    await Promise.all(
      participants.map((participation) =>
        subscriptionLimiter.schedule(async () => {
          const telegramId = participation.user?.telegramId;

          // Без telegramId проверить нечего. Считаем участие валидным: доказать
          // отписку мы не можем, а выкидывать из розыгрыша по недоказанному —
          // хуже, чем оставить.
          if (!telegramId) {
            valid.push(participation.id);
            return;
          }

          try {
            const { passed } = await this.telegramService.checkUserInChannels(
              String(telegramId),
              channelIds,
            );

            (passed ? valid : unsubscribed).push(participation.id);
          } catch (error: any) {
            // Сбой запроса — не доказательство отписки. Оставляем VALID, иначе
            // сетевая ошибка молча лишила бы человека шанса на приз.
            this.logger.warn(
              { contestId, participationId: participation.id, err: error },
              'recheckContestSubscriptions: проверка не удалась, участник остаётся в розыгрыше',
            );
            valid.push(participation.id);
          }
        }),
      ),
    );

    const checkedAt = new Date();

    await this.contestParticipationRepo.markSubscriptionStatuses(
      [
        {
          participationIds: valid,
          status: ParticipationSubscriptionStatus.VALID,
        },
        {
          participationIds: unsubscribed,
          status: ParticipationSubscriptionStatus.UNSUBSCRIBED,
        },
      ],
      checkedAt,
    );

    await this.markContestChecked(contestId, checkedAt);

    this.logger.log(
      {
        contestId,
        participants: participants.length,
        valid: valid.length,
        unsubscribed: unsubscribed.length,
      },
      'recheckContestSubscriptions: перепроверка подписок завершена',
    );

    return {
      skipped: false,
      checked: participants.length,
      unsubscribed: unsubscribed.length,
    };
  }

  /**
   * Отказ от перепроверки после исчерпания попыток: помечаем конкурс
   * проверенным, чтобы завершение пошло дальше со всем пулом.
   *
   * Это осознанный fail-open. Альтернатива — оставить отметку пустой, но тогда
   * finishContestIdempotent снова закажет перепроверку, та снова упадёт, и
   * конкурс останется в ACTIVE навсегда. Незаслуженно выигравший отписавшийся
   * хуже, чем зависший конкурс, только на бумаге: второе не чинится само.
   */
  async abandonRecheck(contestId: number): Promise<void> {
    this.logger.error(
      { contestId },
      'abandonRecheck: перепроверка подписок не удалась, завершаем конкурс без неё',
    );

    await this.markContestChecked(contestId);
  }

  private async markContestChecked(
    contestId: number,
    checkedAt: Date = new Date(),
  ): Promise<void> {
    await this.contestRepo.update(contestId, {
      subscriptionsCheckedAt: checkedAt,
    });
  }
}
