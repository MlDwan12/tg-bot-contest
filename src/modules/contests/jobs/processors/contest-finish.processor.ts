import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ContestsService } from '../../services/contests.service';
import { Logger } from 'nestjs-pino';
import { jobMeta } from 'src/common/helpers/job-meta.helper';

@Processor('contest-finish')
export class ContestFinishProcessor extends WorkerHost {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<{ contestId: number }>) {
    if (job.name !== 'finishContest') return;

    const { contestId } = job.data;

    this.logger.warn({ ...jobMeta(job), contestId }, 'finishContest: start');

    try {
      await this.contestsService.finishContestIdempotent(contestId);
      this.logger.warn({ ...jobMeta(job), contestId }, 'finishContest: done');
    } catch (e: any) {
      this.logger.error(
        { ...jobMeta(job), contestId, err: e?.message ?? e },
        'finishContest: error',
      );
      throw e;
    }
  }
}
