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
  CONTEST_PARTICIPATE_READ_REPOSITORY,
  CONTEST_PARTICIPATE_WRITE_REPOSITORY,
  CONTEST_READ_REPOSITORY,
  CONTEST_WRITE_REPOSITORY,
} from 'src/shared/commons/constants';
import {
  ContestParticipationReadRepository,
  ContestParticipationWriteRepository,
  ContestReadRepository,
  ContestWriteRepository,
} from '../repositories';
import { TelegramUserService } from 'src/modules/users/services';
import { Logger } from 'nestjs-pino';
import { ContestParticipation } from '../entities';
import { ContestStatus } from 'src/shared/enums/contest';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ContestWinnerService } from './contest-winner.service';
import { TelegramService } from 'src/modules/bot/bot.service';

@Injectable()
export class ContestsParticipateService {
  constructor(
    @Inject(CONTEST_READ_REPOSITORY)
    private readonly contestReadRepo: ContestReadRepository,

    @Inject(CONTEST_WRITE_REPOSITORY)
    private readonly contestWriteRepo: ContestWriteRepository,

    @Inject(CONTEST_PARTICIPATE_READ_REPOSITORY)
    private readonly contestParticipationReadRepo: ContestParticipationReadRepository,

    @Inject(CONTEST_PARTICIPATE_WRITE_REPOSITORY)
    private readonly contestParticipationWriteRepo: ContestParticipationWriteRepository,

    @InjectQueue('contest-counters')
    private readonly contestCountersQueue: Queue,
    @Inject(forwardRef(() => TelegramUserService))
    private readonly userTgService: TelegramUserService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    private readonly contestWinnerService: ContestWinnerService,
    private readonly logger: Logger,
  ) {}

  async participate(
    contestId: number,
    tgData: {
      telegramId: string;
      groupId: string;
      username?: string;
      firstName?: string;
      lastName?: string;
    },
  ) {
    const contest = await this.contestReadRepo.findByParams({
      id: contestId,
    });

    if (
      !contest ||
      contest?.status === ContestStatus.CANCELLED ||
      contest?.status === ContestStatus.DRAFT
    ) {
      throw new NotFoundException('Конкурс не найден');
    }

    if (contest.status === ContestStatus.COMPLETED) {
      const winners =
        await this.contestWinnerService.getContestWinners(contestId);

      const w = winners.map((w) => ({
        place: w.place,
        telegramId: w.user?.telegramId ?? null,
        userId: w.userId,
        username: w.user?.username ?? null,
      }));

      return w;
    }

    if (contest.status === ContestStatus.PENDING) {
      throw new BadRequestException('Конкурс ещё не начался');
    }

    if (contest.status !== ContestStatus.ACTIVE) {
      throw new NotFoundException('Конкурс не найден');
    }

    const user = await this.userTgService.ensureUser(tgData);

    const requiredChannels = contest.requiredChannels ?? [];

    if (requiredChannels.length > 0) {
      const channelIds = requiredChannels
        .map((c) => c.telegramId)
        .filter((id): id is number => id != null);

      if (channelIds.length > 0) {
        const { passed, missingChannels } =
          await this.telegramService.checkUserInChannels(
            tgData.telegramId,
            channelIds,
          );

        if (!passed) {
          const usernames = requiredChannels
            .filter(
              (c) =>
                c.telegramId != null && missingChannels.includes(c.telegramId),
            )
            .map((c) =>
              c.telegramUsername
                ? `@${c.telegramUsername}`
                : `id:${c.telegramId}`,
            )
            .join(', ');

          throw new ForbiddenException(
            `Необходимо подписаться на обязательные каналы: ${usernames}`,
          );
        }
      }
    }

    try {
      const participation =
        await this.contestParticipationWriteRepo.createParticipation({
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
        const existing = await this.contestParticipationReadRepo.findOneByParam(
          {
            userId: user.id,
            contestId: contest.id,
          },
        );
        if (existing) return existing; // ← тоже 200
      }

      this.logger.error(
        { err: error, contestId, tgData },
        'Ошибка при участии в конкурсе',
      );
      throw error;
    }
  }

  async findManyByContestId(
    contestId: number,
  ): Promise<ContestParticipation[]> {
    return this.contestParticipationReadRepo.findManyByContestId(contestId);
  }

  async syncParticipantsWithWinners(
    contestId: number,
    winners: Array<{ userId: number; place: number }>,
  ): Promise<void> {
    // Сброс и простановка флагов в одной транзакции: если между reset и mark
    // придёт параллельный читатель, он увидит либо старые данные, либо новые —
    // никогда не увидит состояние "все сброшены, ни один не отмечен победителем".
    await this.contestParticipationWriteRepo.syncWinnerFlagsInTransaction(
      contestId,
      winners,
    );
  }
}
