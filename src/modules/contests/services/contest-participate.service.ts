import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  forwardRef,
} from '@nestjs/common';
import {
  CONTEST_PARTICIPATE_REPOSITORY,
  CONTEST_REPOSITORY,
} from 'src/common/constants';
import type {
  IContestParticipationRepository,
  IContestRepository,
} from '../interfaces';
import { TelegramUserService } from 'src/modules/users/services';
import { Logger } from 'nestjs-pino';
import { Contest, ContestParticipation } from '../entities';
import { ContestStatus } from 'src/common/enums/contest';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ContestWinnerService } from './contest-winner.service';
import { TelegramService } from 'src/modules/bot/bot.service';

type ParticipateInput = {
  telegramId: string;
  groupId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
};

@Injectable()
export class ContestsParticipateService {
  constructor(
    @Inject(CONTEST_REPOSITORY)
    private readonly contestRepo: IContestRepository,

    @Inject(CONTEST_PARTICIPATE_REPOSITORY)
    private readonly contestParticipationRepo: IContestParticipationRepository,

    @InjectQueue('contest-counters')
    private readonly contestCountersQueue: Queue,
    @Inject(forwardRef(() => TelegramUserService))
    private readonly userTgService: TelegramUserService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    private readonly contestWinnerService: ContestWinnerService,
    private readonly logger: Logger,
  ) {}

  /**
   * Оркестрация участия. Порядок шагов сохранён 1:1 с прежней реализацией
   * (закреплён характеризацией Ф10.1): найден/не отменён → завершён отдаёт
   * победителей → активен → подписка на обязательные каналы → запись участия.
   */
  async participate(contestId: number, tgData: ParticipateInput) {
    const contest = await this.contestRepo.findByParams({ id: contestId });
    this.assertContestFound(contest);

    if (contest.status === ContestStatus.COMPLETED) {
      return this.getCompletedContestWinners(contestId);
    }

    this.assertContestActive(contest);

    const user = await this.userTgService.ensureUser(tgData);

    await this.assertUserSubscribedToRequiredChannels(
      contest,
      tgData.telegramId,
    );

    return this.persistParticipation(contest, user, tgData);
  }

  /**
   * Конкурс должен существовать и не быть отменённым/черновиком — иначе для
   * участника он «не найден». После вызова TS знает, что contest не null.
   */
  private assertContestFound(
    contest: Contest | null,
  ): asserts contest is Contest {
    if (
      !contest ||
      contest.status === ContestStatus.CANCELLED ||
      contest.status === ContestStatus.DRAFT
    ) {
      throw new NotFoundException('Конкурс не найден');
    }
  }

  /** Активный конкурс: до старта → 400; любой иной не-ACTIVE → 404. */
  private assertContestActive(contest: Contest): void {
    if (contest.status === ContestStatus.PENDING) {
      throw new BadRequestException('Конкурс ещё не начался');
    }

    if (contest.status !== ContestStatus.ACTIVE) {
      throw new NotFoundException('Конкурс не найден');
    }
  }

  /** Завершённый конкурс: participate возвращает победителей, а не участие. */
  private async getCompletedContestWinners(contestId: number) {
    const winners =
      await this.contestWinnerService.getContestWinners(contestId);

    return winners.map((w) => ({
      place: w.place,
      telegramId: w.user?.telegramId ?? null,
      userId: w.userId,
      // Фиктивный победитель (ник без TG) не имеет user — отдаём вписанный ник
      // в том же поле username, telegramId/userId остаются null.
      username: w.user?.username ?? w.displayUsername ?? null,
    }));
  }

  /**
   * Участие запрещено, пока пользователь не подписан на обязательные каналы.
   * Нет обязательных каналов (или у них нет telegramId) → проверка пропускается.
   */
  private async assertUserSubscribedToRequiredChannels(
    contest: Contest,
    telegramId: string,
  ): Promise<void> {
    const requiredChannels = contest.requiredChannels ?? [];
    if (requiredChannels.length === 0) return;

    const channelIds = requiredChannels
      .map((c) => c.telegramId)
      .filter((id): id is number => id != null);
    if (channelIds.length === 0) return;

    const { passed, missingChannels } =
      await this.telegramService.checkUserInChannels(telegramId, channelIds);
    if (passed) return;

    const usernames = requiredChannels
      .filter(
        (c) => c.telegramId != null && missingChannels.includes(c.telegramId),
      )
      .map((c) =>
        c.telegramUsername ? `@${c.telegramUsername}` : `id:${c.telegramId}`,
      )
      .join(', ');

    throw new ForbiddenException(
      `Необходимо подписаться на обязательные каналы: ${usernames}`,
    );
  }

  /**
   * Пишет участие + ставит джоб пересчёта счётчика. Идемпотентность: при гонке
   * дублей (уникальный индекс [contestId, userId], код 23505) возвращает уже
   * существующее участие, а не падает.
   */
  private async persistParticipation(
    contest: Contest,
    user: { id: number },
    tgData: ParticipateInput,
  ): Promise<ContestParticipation> {
    try {
      const participation =
        await this.contestParticipationRepo.createParticipation({
          contestId: contest.id,
          userId: user.id,
          groupId: tgData.groupId,
        });

      // BullMQ гарантирует уникальность по jobId: если джоб с таким id уже
      // стоит в очереди (delayed/waiting), повторный add его не дублирует.
      // Поэтому getJob+remove+add заменяем на простой add — это атомарно
      // и безопасно при параллельных запросах.
      const counterJobId = `contest-counter-${contest.id}`;
      const job = await this.contestCountersQueue.add(
        'sync-participants-counter',
        { contestId: contest.id },
        {
          jobId: counterJobId,
          delay: 2000,
          removeOnComplete: true,
          removeOnFail: 5000,
        },
      );

      this.logger.debug({
        contestId: contest.id,
        jobId: job.id,
      });

      return participation;
    } catch (error) {
      if (error?.code === '23505') {
        // Уникальный индекс стоит на [contestId, userId] — без groupId.
        // Пользователь мог прийти из другого чата (другой groupId), но участие
        // уже существует. Ищем только по userId+contestId, иначе findOne
        // вернёт null и клиент получит 500 вместо своей записи.
        const existing = await this.contestParticipationRepo.findOneByParam({
          userId: user.id,
          contestId: contest.id,
        });
        if (existing) return existing; // ← тоже 200
      }

      this.logger.error(
        { err: error, contestId: contest.id, tgData },
        'Ошибка при участии в конкурсе',
      );
      throw error;
    }
  }

  async findManyByContestId(
    contestId: number,
  ): Promise<ContestParticipation[]> {
    return this.contestParticipationRepo.findManyByContestId(contestId);
  }

  async syncParticipantsWithWinners(
    contestId: number,
    winners: Array<{ userId: number; place: number }>,
  ): Promise<void> {
    // Сброс и простановка флагов в одной транзакции: если между reset и mark
    // придёт параллельный читатель, он увидит либо старые данные, либо новые —
    // никогда не увидит состояние "все сброшены, ни один не отмечен победителем".
    await this.contestParticipationRepo.syncWinnerFlagsInTransaction(
      contestId,
      winners,
    );
  }
}
