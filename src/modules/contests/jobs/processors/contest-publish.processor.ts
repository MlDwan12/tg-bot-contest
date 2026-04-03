import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { ContestsService } from '../../services/contests.service';
import { Logger } from 'nestjs-pino';
import { jobMeta } from 'src/common/helpers/job-meta.helper';

@Processor('contest-scheduler')
export class ContestPublishProcessor extends WorkerHost {
  constructor(
    private readonly contestsService: ContestsService,
    @InjectQueue('contest-publication')
    private readonly publicationQueue: Queue,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<{ contestId: number }>) {
    if (job.name !== 'publishContest') return;

    const { contestId } = job.data;

    this.logger.debug({ ...jobMeta(job), contestId }, 'publishContest: start');

    try {
      await this.contestsService.activateContestIfDue(contestId);

      const publicationIds =
        await this.contestsService.getPendingPublicationIds(contestId);

      this.logger.debug(
        {
          ...jobMeta(job),
          contestId,
          pendingPublications: publicationIds.length,
          publicationIds,
        },
        'publishContest: pending publications fetched',
      );

      let added = 0;
      for (const publicationId of publicationIds) {
        await this.publicationQueue.add(
          'sendPublication',
          { publicationId },
          { jobId: `publication:${publicationId}:send` },
        );
        added++;
      }

      this.logger.debug(
        { ...jobMeta(job), contestId, added },
        'publishContest: sendPublication jobs added',
      );
    } catch (e: any) {
      this.logger.error(
        { ...jobMeta(job), contestId, err: e?.message ?? e },
        'publishContest: error',
      );
      throw e;
    }
  }
}
