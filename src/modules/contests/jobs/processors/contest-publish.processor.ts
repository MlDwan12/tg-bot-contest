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
    this.logger.log('ContestPublishProcessor initialized');
  }

  async process(job: Job<{ contestId: number }>) {
    if (job.name !== 'publishContest') return;
    const { contestId } = job.data;

    const counts = await this.publicationQueue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused',
    );

    this.logger.debug(
      { contestId, counts },
      'publishContest: publication queue counts',
    );

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
        const publicationJob = await this.publicationQueue.add(
          'sendPublication',
          { publicationId },
          { jobId: `publication:${publicationId}:send` },
        );

        setTimeout(async () => {
          const reloaded = await this.publicationQueue.getJob(
            publicationJob.id!,
          );

          this.logger.error(
            {
              pid: process.pid,
              publicationId,
              jobId: reloaded?.id,
              jobName: reloaded?.name,
              state: reloaded ? await reloaded.getState() : null,
              data: reloaded?.data,
              attemptsMade: reloaded?.attemptsMade,
              failedReason: reloaded?.failedReason,
              returnvalue: reloaded?.returnvalue,
              processedOn: reloaded?.processedOn,
              finishedOn: reloaded?.finishedOn,
            },
            'publishContest: sendPublication final details',
          );
        }, 1000);

        this.logger.debug(
          {
            publicationId,
            publicationJobId: publicationJob.id,
            publicationJobName: publicationJob.name,
            publicationJobState: await publicationJob.getState(),
            publicationJobData: publicationJob.data,
          },
          'publishContest: sendPublication enqueued',
        );
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
