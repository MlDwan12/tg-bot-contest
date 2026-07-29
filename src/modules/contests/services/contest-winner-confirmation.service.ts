import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { CONTEST_WINNER_REPOSITORY } from 'src/common/constants';
import type { IContestWinnerRepository } from '../interfaces';
import { ContestWinnerStatus } from 'src/common/enums/contest';

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

    this.logger.log(
      { winnerId, contestId: winner.contestId, userId: winner.userId, status },
      'confirmation: победитель принял решение по призу',
    );

    return accepted ? 'confirmed' : 'declined';
  }
}
