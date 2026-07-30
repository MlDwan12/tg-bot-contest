import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import {
  CONTEST_PARTICIPATE_REPOSITORY,
  CONTEST_REPOSITORY,
  CONTEST_WINNER_REPOSITORY,
} from 'src/common/constants';
import type {
  IContestParticipationRepository,
  IContestRepository,
  IContestWinnerRepository,
} from '../interfaces';
import { ContestWinnerStatus, WinnerStrategy } from 'src/common/enums/contest';
import { ContestWinnerAuditRepository } from '../repositories';
import { seededShuffle } from './seeded-draw.util';
import { ContestSubscriptionRecheckService } from './contest-subscription-recheck.service';

/** Замена состоялась / замены нет и почему. */
export type ReplacementResult =
  | { status: 'replaced'; winnerId: number; userId: number; place: number }
  | { status: 'no_candidates' }
  | { status: 'not_applicable' };

/**
 * Автодобор: освободившееся место занимает следующий по жеребьёвке.
 *
 * Отдельного «резерва» нет — очередью служит то же перемешивание
 * shuffle(seed, pool), которым определены победители. Порядок предопределён ДО
 * того, как стало известно, кто откажется, поэтому повлиять на состав замен
 * нельзя, а любой проверяющий пересчитает его из seed и пула в аудите.
 *
 * Почему не «перерандомить заново»: новый seed = новый розыгрыш, и снаружи не
 * отличить честный перерозыгрыш от прокрутки до нужного человека.
 */
@Injectable()
export class ContestWinnerReplacementService {
  constructor(
    @Inject(CONTEST_REPOSITORY)
    private readonly contestRepo: IContestRepository,

    @Inject(CONTEST_WINNER_REPOSITORY)
    private readonly contestWinnerRepo: IContestWinnerRepository,

    @Inject(CONTEST_PARTICIPATE_REPOSITORY)
    private readonly contestParticipationRepo: IContestParticipationRepository,

    private readonly auditRepo: ContestWinnerAuditRepository,
    private readonly recheckService: ContestSubscriptionRecheckService,
    private readonly logger: Logger,
  ) {}

  /**
   * Пытается закрыть место, освободившееся после DECLINED/EXPIRED.
   * Возвращает исход — уведомления рассылает вызывающий процессор.
   */
  async fillVacatedPlace(
    contestId: number,
    place: number,
  ): Promise<ReplacementResult> {
    const contest = await this.contestRepo.findByParams({ id: contestId });

    if (!contest) return { status: 'not_applicable' };

    // У MANUAL жеребьёвки не было, брать замену неоткуда: решение за оператором.
    if (contest.winnerStrategy !== WinnerStrategy.RANDOM) {
      return { status: 'not_applicable' };
    }

    const draw = await this.auditRepo.findDrawByContestId(contestId);

    if (!draw?.seed || !draw.participantUserIds?.length) {
      this.logger.warn(
        { contestId },
        'replacement: нет следа розыгрыша (seed/пул) — заменить некем',
      );
      return { status: 'no_candidates' };
    }

    // Тот же вход и тот же seed → тот же порядок, что и в исходном розыгрыше.
    const order = seededShuffle(draw.participantUserIds, draw.seed);

    const winners = await this.contestWinnerRepo.findByContestId(contestId);
    const alreadyWinner = new Set(
      winners.map((winner) => winner.userId).filter((id): id is number => !!id),
    );

    // Кандидаты — всё, что за призовыми местами. Уже побывавших победителями
    // пропускаем: так поиск идемпотентен и переживает повторный запуск джоба,
    // отдельный счётчик замен хранить не нужно.
    const candidates = order
      .slice(draw.prizePlaces)
      .filter((userId) => !alreadyWinner.has(userId));

    const skipped: number[] = [];

    for (const candidateUserId of candidates) {
      const stillSubscribed = await this.isStillSubscribed(
        contestId,
        candidateUserId,
      );

      if (!stillSubscribed) {
        skipped.push(candidateUserId);
        continue;
      }

      return this.promote(contestId, place, candidateUserId, skipped, draw);
    }

    this.logger.warn(
      { contestId, place, skipped },
      'replacement: очередь жеребьёвки исчерпана, место осталось незакрытым',
    );

    return { status: 'no_candidates' };
  }

  private async promote(
    contestId: number,
    place: number,
    userId: number,
    skipped: number[],
    draw: { prizePlaces: number },
  ): Promise<ReplacementResult> {
    const contest = await this.contestRepo.findByParams({ id: contestId });

    const requiresConfirmation = contest?.requireWinnerConfirmation ?? false;
    const hours = contest?.confirmationHours ?? 24;

    const created = await this.contestWinnerRepo.append({
      contestId,
      userId,
      place,
      // Заменивший получает ПОЛНЫЙ срок с момента назначения, а не остаток
      // чужого: он только сейчас узнал о призе.
      status: requiresConfirmation
        ? ContestWinnerStatus.PENDING_CONFIRMATION
        : ContestWinnerStatus.CONFIRMED,
      confirmationDeadline: requiresConfirmation
        ? new Date(Date.now() + hours * 60 * 60 * 1000)
        : null,
    });

    // След замены обязателен, и пропущенных в нём называем поимённо: иначе
    // проверяющий пересчитает shuffle, увидит на месте не следующего по порядку
    // и решит, что розыгрыш подкручен.
    await this.auditRepo.record({
      contestId,
      strategy: `${WinnerStrategy.RANDOM}_replacement`,
      prizePlaces: draw.prizePlaces,
      winnerUserIds: [userId],
      note:
        `Автодобор на место ${place}: userId ${userId}` +
        (skipped.length
          ? `; пропущены (отписались): ${skipped.join(', ')}`
          : ''),
    });

    // Флаги в contest_participants держим в согласии с реальными победителями:
    // иначе отказавшийся остался бы помечен isWinner, а заменивший — нет, и
    // это увидели бы и CSV-выгрузка, и мини-апп. Синхронизируем по ЖИВЫМ
    // строкам (подтверждённые и ждущие решения), отказавшихся флаг теряет.
    await this.syncParticipantFlags(contestId);

    this.logger.log(
      { contestId, place, userId, skipped },
      'replacement: место закрыто следующим по жеребьёвке',
    );

    return { status: 'replaced', winnerId: created.id, userId, place };
  }

  /** Живой победитель места — подтвердивший или ещё думающий. */
  private async syncParticipantFlags(contestId: number): Promise<void> {
    const winners = await this.contestWinnerRepo.findByContestId(contestId);

    const active = winners
      .filter(
        (winner) =>
          winner.userId != null &&
          (winner.status === ContestWinnerStatus.CONFIRMED ||
            winner.status === ContestWinnerStatus.PENDING_CONFIRMATION),
      )
      .map((winner) => ({
        userId: winner.userId as number,
        place: winner.place,
      }));

    await this.contestParticipationRepo.syncWinnerFlagsInTransaction(
      contestId,
      active,
    );
  }

  /**
   * Кандидат мог отписаться уже после финиша, а приз достаётся ему сейчас —
   * поэтому подписку проверяем в момент назначения. Проверка одного человека
   * стоит один запрос, в отличие от общей перепроверки пула на финише.
   */
  private async isStillSubscribed(
    contestId: number,
    userId: number,
  ): Promise<boolean> {
    try {
      return await this.recheckService.isUserStillSubscribed(contestId, userId);
    } catch (error) {
      // Telegram недоступен — считаем подписку в силе. Лишить приза из-за
      // нашего сбоя хуже, чем пропустить отписавшегося: подписку он уже
      // подтверждал при участии.
      this.logger.error(
        { err: error, contestId, userId },
        'replacement: не удалось проверить подписку кандидата, считаем валидным',
      );
      return true;
    }
  }
}
