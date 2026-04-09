import {
  Injectable,
  Inject,
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
import { ContestWinnerService } from '.';
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
    const user = await this.userTgService.ensureUser(tgData);

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

    if (contest.status !== ContestStatus.ACTIVE) {
      throw new NotFoundException('Конкурс не найден или завершен');
    }

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
      const counterJobId = `contest-counter-${contest.id}`;

      const existingJob = await this.contestCountersQueue.getJob(counterJobId);

      if (existingJob) {
        await existingJob.remove();
      }

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
        const existing = await this.contestParticipationReadRepo.findOneByParam(
          {
            userId: user.id,
            contestId: contest.id,
            groupId: tgData.groupId,
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
    await this.contestParticipationWriteRepo.resetWinnerFlags(contestId);

    for (const winner of winners) {
      await this.contestParticipationWriteRepo.markAsWinner(
        contestId,
        winner.userId,
        winner.place,
      );
    }
  }
}
