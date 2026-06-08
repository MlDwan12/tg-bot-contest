import { Inject, Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import {
  ContestParticipationReadRepository,
  ContestReadRepository,
  ContestWriteRepository,
} from '../repositories';
import {
  CONTEST_PARTICIPATE_READ_REPOSITORY,
  CONTEST_READ_REPOSITORY,
  CONTEST_WRITE_REPOSITORY,
} from 'src/shared/commons/constants';
import { Contest } from '../entities';
import { ContestStatus, WinnerStrategy } from 'src/shared/enums/contest';
import { ContestJobsService } from '../jobs/services';
import { ContestWinnerService } from './contest-winner.service';
import { ContestPublicationService } from './contest-publication.service';

@Injectable()
export class ContestLifecycleService {
  constructor(
    @Inject(CONTEST_READ_REPOSITORY)
    private readonly contestReadRepo: ContestReadRepository,

    @Inject(CONTEST_WRITE_REPOSITORY)
    private readonly contestWriteRepo: ContestWriteRepository,

    @Inject(CONTEST_PARTICIPATE_READ_REPOSITORY)
    private readonly contestParticipationReadRepo: ContestParticipationReadRepository,

    @InjectQueue('contest-publication')
    private readonly publicationQueue: Queue,

    private readonly contestJobsService: ContestJobsService,
    private readonly contestWinnerService: ContestWinnerService,
    private readonly contestPublicationService: ContestPublicationService,
    private readonly logger: Logger,
  ) {}

  async activateContestIfDue(contestId: number): Promise<void> {
    const contest = await this.contestReadRepo.findByParams({ id: contestId });
    if (!contest) return;

    if (contest.status !== ContestStatus.PENDING) return;

    const now = new Date();
    if (contest.startDate > now) return;

    await this.contestWriteRepo.updateStatusIfCurrent(
      contestId,
      ContestStatus.PENDING,
      ContestStatus.ACTIVE,
    );
  }

  async isContestCompleted(contestId: number): Promise<boolean> {
    const contest = await this.contestReadRepo.findByParams({ id: contestId });
    return !!contest && contest.status === ContestStatus.COMPLETED;
  }

  async finishContestIdempotent(contestId: number): Promise<void> {
    const contest = await this.contestReadRepo.findByIdWithRelations(contestId);
    if (!contest) return;

    if (contest.status === ContestStatus.COMPLETED) return;

    const now = new Date();
    if (contest.endDate > now) return;

    const participants =
      await this.contestParticipationReadRepo.findManyByContestId(contest.id);
    const hasParticipants = participants.length > 0;

    if (hasParticipants) {
      await this.contestWinnerService.resolveAndSaveWinners(contest);
    }

    const changed =
      await this.contestWriteRepo.updateStatusIfNotCompleted(contestId);
    if (!changed) return;

    const publicationIds =
      await this.contestPublicationService.getPublishedPublicationIdsForContest(
        contestId,
      );

    this.logger.warn(
      { contestId, hasParticipants, publicationIds },
      'finishContestIdempotent: publications for finished button update',
    );

    for (const publicationId of publicationIds) {
      await this.publicationQueue.add(
        'updateFinishedButton',
        { publicationId, hasParticipants },
        { jobId: `publication:${publicationId}:finish-button` },
      );
    }
  }

  async completeContest(contestId: number): Promise<Contest> {
    const contest = await this.contestReadRepo.findByIdWithRelations(contestId);

    if (!contest) {
      throw new NotFoundException('Конкурс не найден');
    }

    if (contest.status === ContestStatus.COMPLETED) {
      throw new BadRequestException('Конкурс уже завершён');
    }

    if (contest.status === ContestStatus.CANCELLED) {
      throw new BadRequestException('Нельзя завершить отменённый конкурс');
    }

    if (contest.status === ContestStatus.PENDING) {
      throw new BadRequestException('Нельзя завершить конкурс до его старта');
    }

    await this.contestWinnerService.resolveAndSaveWinners(contest);

    await this.contestWriteRepo.update(contest.id, {
      status: ContestStatus.COMPLETED,
      buttonText: 'Конкурс завершён',
    });

    const updatedContest = await this.contestReadRepo.findByIdWithRelations(
      contest.id,
    );

    if (!updatedContest) {
      throw new NotFoundException('Конкурс не найден после завершения');
    }

    await this.contestPublicationService.syncPublishedPosts(updatedContest);

    return updatedContest;
  }

  async cancelContest(id: number): Promise<Contest> {
    const contest = await this.contestReadRepo.findByIdWithRelations(id);

    if (!contest) {
      throw new NotFoundException('Конкурс не найден');
    }

    if (contest.status === ContestStatus.CANCELLED) {
      throw new BadRequestException('Конкурс уже отменён');
    }

    if (contest.status === ContestStatus.COMPLETED) {
      throw new BadRequestException('Нельзя отменить завершённый конкурс');
    }

    const hasWinners = Boolean(contest.winners?.length);

    if (hasWinners && contest.winnerStrategy !== WinnerStrategy.MANUAL) {
      throw new BadRequestException(
        'Нельзя отменить конкурс с выбранными победителями, если стратегия не manual',
      );
    }

    await this.contestJobsService.removeContestJobs(contest.id);
    await this.contestPublicationService.cancelContestPublications(contest.id);

    await this.contestWriteRepo.update(contest.id, {
      status: ContestStatus.CANCELLED,
    });

    const updatedContest = await this.contestReadRepo.findByIdWithRelations(id);

    if (!updatedContest) {
      throw new NotFoundException('Конкурс не найден после отмены');
    }

    return updatedContest;
  }
}
