import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import {
  CONTEST_PARTICIPATE_REPOSITORY,
  CONTEST_REPOSITORY,
} from 'src/common/constants';
import { ContestStatus } from 'src/common/enums/contest';
import type {
  IContestParticipationRepository,
  IContestRepository,
} from '../interfaces';
import { Contest } from '../entities';
import { ContestPublicationService } from './contest-publication.service';

export const BOOST_TICK_JOB = 'boost-tick';

/**
 * Задержки (мс) для count отложенных +1 в окне windowMs: окно делится на
 * count равных слотов, каждая задержка — случайная точка в середине своего
 * слота (±30% шага). Результат растёт монотонно и не выходит за окно.
 */
export function buildBoostDelays(count: number, windowMs: number): number[] {
  const step = windowMs / count;
  return Array.from({ length: count }, (_, i) =>
    Math.round(step * i + step * (0.5 + (Math.random() - 0.5) * 0.6)),
  );
}

/**
 * Админская накрутка счётчика на кнопке поста. Меняет ТОЛЬКО
 * Contest.displayBonus — реальные участники, розыгрыш и статистика не трогаются.
 */
@Injectable()
export class ContestBoostService {
  constructor(
    @Inject(CONTEST_REPOSITORY)
    private readonly contestRepo: IContestRepository,
    @Inject(CONTEST_PARTICIPATE_REPOSITORY)
    private readonly participationRepo: IContestParticipationRepository,
    private readonly publicationService: ContestPublicationService,
    @InjectQueue('contest-counters')
    private readonly countersQueue: Queue,
    private readonly logger: Logger,
  ) {}

  async getStatus(contestId: number) {
    const contest = await this.contestRepo.findById(contestId);
    if (!contest) throw new BadRequestException('Конкурс не найден');

    const [real, bonus, pending] = await Promise.all([
      this.participationRepo.countUniqueUsersByContestId(contestId),
      this.contestRepo.getDisplayBonus(contestId),
      this.findPendingTicks(contestId),
    ]);

    return { contest, real, bonus, pending: pending.length };
  }

  async addNow(contestId: number, count: number): Promise<void> {
    await this.getActiveContest(contestId);
    await this.contestRepo.incrementDisplayBonus(contestId, count);
    await this.publicationService.syncParticipantsCounter(contestId);
    this.logger.log({ contestId, count }, 'Накрутка счётчика: сразу');
  }

  /**
   * Ставит count отложенных +1 на periodMinutes (null — до конца конкурса).
   * Окно обрезается по endDate. Возвращает фактическое окно в минутах.
   */
  async schedule(
    contestId: number,
    count: number,
    periodMinutes: number | null,
  ): Promise<number> {
    const contest = await this.getActiveContest(contestId);
    const now = Date.now();
    const untilEnd = new Date(contest.endDate).getTime() - now;
    const windowMs =
      periodMinutes === null
        ? untilEnd
        : Math.min(periodMinutes * 60_000, untilEnd);

    if (windowMs < 60_000) {
      throw new BadRequestException('До конца конкурса меньше минуты');
    }

    await this.countersQueue.addBulk(
      buildBoostDelays(count, windowMs).map((delay, i) => ({
        name: BOOST_TICK_JOB,
        data: { contestId },
        opts: {
          // Ровно три сегмента через ':' — иначе BullMQ роняет весь addBulk.
          jobId: `boost:${contestId}:${now}-${i}`,
          delay,
          // Без ретраев: повтор после частичного успеха дал бы лишний +1.
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      })),
    );

    this.logger.log(
      { contestId, count, windowMs },
      'Накрутка счётчика: запланирована',
    );
    return Math.round(windowMs / 60_000);
  }

  /** Обработчик одной отложенной задачи: +1, если конкурс ещё идёт. */
  async tick(contestId: number): Promise<void> {
    const contest = await this.contestRepo.findById(contestId);
    if (contest?.status !== ContestStatus.ACTIVE) return;

    await this.contestRepo.incrementDisplayBonus(contestId, 1);
    await this.publicationService.syncParticipantsCounter(contestId);
  }

  async stop(contestId: number): Promise<number> {
    const jobs = await this.findPendingTicks(contestId);
    await Promise.all(jobs.map((job) => job.remove()));
    this.logger.log(
      { contestId, removed: jobs.length },
      'Накрутка счётчика: остановлена',
    );
    return jobs.length;
  }

  // ponytail: сканирует все delayed-задачи очереди; при тысячах задач —
  // хранить jobId накрутки по конкурсу отдельно.
  private async findPendingTicks(contestId: number) {
    const delayed = await this.countersQueue.getDelayed();
    return delayed.filter(
      (job) =>
        job.name === BOOST_TICK_JOB && job.data?.contestId === contestId,
    );
  }

  private async getActiveContest(contestId: number): Promise<Contest> {
    const contest = await this.contestRepo.findById(contestId);
    if (!contest) throw new BadRequestException('Конкурс не найден');
    if (contest.status !== ContestStatus.ACTIVE) {
      throw new BadRequestException('Конкурс не активен');
    }
    return contest;
  }
}
