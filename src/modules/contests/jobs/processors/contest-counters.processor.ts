import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { ContestPublicationService } from '../../services/contest-publication.service';
import {
  BOOST_TICK_JOB,
  ContestBoostService,
} from '../../services/contest-boost.service';

@Processor('contest-counters')
export class ContestCountersProcessor extends WorkerHost {
  constructor(
    private readonly contestPublicationService: ContestPublicationService,
    private readonly contestBoostService: ContestBoostService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<{ contestId: number }>): Promise<void> {
    this.logger.debug(
      { contestId: job.data.contestId, jobId: job.id },
      'Запущена синхронизация счетчика участников',
    );

    this.logger.debug(
      { contestId: job.data.contestId },
      'Запущена синхронизация счетчика участников',
    );
    switch (job.name) {
      case 'sync-participants-counter':
        await this.contestPublicationService.syncParticipantsCounter(job.data.contestId);
        return;

      case BOOST_TICK_JOB:
        await this.contestBoostService.tick(job.data.contestId);
        return;

      default:
        this.logger.warn(
          { jobName: job.name, jobId: job.id },
          'Неизвестная job в очереди contest-counters',
        );
    }
  }
}
