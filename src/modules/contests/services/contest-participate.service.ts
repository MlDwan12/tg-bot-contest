import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
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
      status: ContestStatus.ACTIVE,
    });

    if (!contest) {
      throw new NotFoundException('Конкурс не найден или завершен');
    }

    const existingParticipation =
      await this.contestParticipationReadRepo.findOneByParam({
        userId: user.id,
        contestId: contest.id,
        groupId: tgData.groupId,
      });

    if (existingParticipation) {
      throw new ConflictException('Вы уже участвуете в этом конкурсе');
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
      this.logger.error(
        {
          err: error,
          contestId,
          tgData,
        },
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
