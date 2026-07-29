import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { CONTEST_WINNER_REPOSITORY } from 'src/common/constants';
import type { IContestWinnerRepository } from '../interfaces';
import { ContestWinnerStatus } from 'src/common/enums/contest';
import { PLACE_VACATED_JOB } from '../jobs/contest-winner-confirm.jobs';

/** Что показать нажавшему кнопку. Тексты — в обработчике, здесь только исход. */
export type ConfirmationOutcome =
  | 'confirmed'
  | 'declined'
  | 'already_resolved'
  | 'expired'
  | 'not_found'
  | 'foreign';

/**
 * Подтверждение приза победителем. Вызывается из обработчика inline-кнопки:
 * нажатие приходит от Telegram, поэтому доверять данным кнопки нельзя —
 * проверяем и владельца, и срок, и текущий статус.
 */
@Injectable()
export class ContestWinnerConfirmationService {
  constructor(
    @Inject(CONTEST_WINNER_REPOSITORY)
    private readonly contestWinnerRepo: IContestWinnerRepository,

    @InjectQueue('contest-winner-confirm')
    private readonly confirmQueue: Queue,

    private readonly logger: Logger,
  ) {}

  async confirm(
    winnerId: number,
    fromTelegramId: string,
  ): Promise<ConfirmationOutcome> {
    return this.resolve(winnerId, fromTelegramId, true);
  }

  async decline(
    winnerId: number,
    fromTelegramId: string,
  ): Promise<ConfirmationOutcome> {
    return this.resolve(winnerId, fromTelegramId, false);
  }

  private async resolve(
    winnerId: number,
    fromTelegramId: string,
    accepted: boolean,
  ): Promise<ConfirmationOutcome> {
    const winner = await this.contestWinnerRepo.findById(winnerId);

    if (!winner) return 'not_found';

    // callback_data приходит от клиента и содержит только id строки: нажать
    // кнопку может кто угодно, кому переслали сообщение. Сверяем нажавшего с
    // владельцем приза — иначе чужой отказ освободил бы место.
    if (
      !winner.user?.telegramId ||
      String(winner.user.telegramId) !== String(fromTelegramId)
    ) {
      this.logger.warn(
        { winnerId, fromTelegramId },
        'confirmation: кнопку нажал не владелец приза',
      );
      return 'foreign';
    }

    if (winner.status !== ContestWinnerStatus.PENDING_CONFIRMATION) {
      return 'already_resolved';
    }

    // Срок вышел, но джоб дедлайна ещё не отработал (отставание очереди):
    // принимать решение поздно, иначе победитель успевал бы подтвердить
    // «задним числом» уже после того, как место считается освободившимся.
    if (
      winner.confirmationDeadline &&
      winner.confirmationDeadline < new Date()
    ) {
      return 'expired';
    }

    const status = accepted
      ? ContestWinnerStatus.CONFIRMED
      : ContestWinnerStatus.DECLINED;

    const changed = await this.contestWinnerRepo.resolveConfirmation(
      winnerId,
      status,
      accepted ? new Date() : null,
    );

    // false — между findById и UPDATE статус успели сменить (двойной клик,
    // джоб дедлайна). Победила первая операция, и это нормальный исход.
    if (!changed) return 'already_resolved';

    // Отказ освобождает место — добор запускаем джобом, а не здесь: у
    // победителя на кнопке крутятся «часики», и заставлять его ждать похода в
    // Telegram за подпиской кандидата незачем.
    if (!accepted) {
      await this.enqueuePlaceVacated(winner.contestId, winner.place, winnerId);
    }

    this.logger.log(
      { winnerId, contestId: winner.contestId, userId: winner.userId, status },
      'confirmation: победитель принял решение по призу',
    );

    return accepted ? 'confirmed' : 'declined';
  }

  /**
   * jobId по id СТРОКИ, а не по месту: на одном месте отказаться может
   * несколько человек подряд, и ключ вида vacated-<place> оказался бы занят
   * первым отказом — BullMQ молча не создал бы джоб, и второй добор не
   * состоялся бы. Повторный отказ той же строки при этом по-прежнему
   * дедуплицируется.
   */
  private async enqueuePlaceVacated(
    contestId: number,
    place: number,
    winnerId: number,
  ): Promise<void> {
    await this.confirmQueue.add(
      PLACE_VACATED_JOB,
      { contestId, place },
      { jobId: `contest:${contestId}:vacated-${winnerId}` },
    );
  }
}
