import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ContestLifecycleService } from '../../services/contest-lifecycle.service';
import { ContestSubscriptionRecheckService } from '../../services/contest-subscription-recheck.service';
import { ContestJobsService } from '../../services/contest-jobs.service';
import { Logger } from 'nestjs-pino';
import { jobMeta } from 'src/common/helpers/job-meta.helper';

@Processor('contest-finish')
export class ContestFinishProcessor extends WorkerHost {
  constructor(
    private readonly contestLifecycleService: ContestLifecycleService,
    private readonly contestSubscriptionRecheckService: ContestSubscriptionRecheckService,
    private readonly contestJobsService: ContestJobsService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<{ contestId: number }>) {
    if (job.name === 'recheckSubscriptions') {
      await this.recheckSubscriptions(job);
      return;
    }

    if (job.name !== 'finishContest') return;

    const { contestId } = job.data;

    this.logger.log({ ...jobMeta(job), contestId }, 'finishContest: start');

    try {
      await this.contestLifecycleService.finishContestIdempotent(contestId);
      this.logger.log({ ...jobMeta(job), contestId }, 'finishContest: done');
    } catch (e: any) {
      this.logger.error(
        { ...jobMeta(job), contestId, err: e?.message ?? e },
        'finishContest: error',
      );
      throw e;
    }
  }

  /**
   * Первая фаза завершения: перепроверить подписки, затем снова позвать
   * finishContest — уже с отсеянным пулом.
   *
   * Завершение переставляется через scheduleFinishRetry: у него уникальный
   * jobId. Переиспользовать contest:<id>:finish нельзя — BullMQ молча не
   * создаст задачу, если джоб с таким id ещё не вычищен.
   */
  private async recheckSubscriptions(
    job: Job<{ contestId: number }>,
  ): Promise<void> {
    const { contestId } = job.data;

    this.logger.log(
      { ...jobMeta(job), contestId },
      'recheckSubscriptions: start',
    );

    try {
      const result =
        await this.contestSubscriptionRecheckService.recheckContestSubscriptions(
          contestId,
        );

      this.logger.log(
        { ...jobMeta(job), contestId, ...result },
        'recheckSubscriptions: done',
      );
    } catch (error: any) {
      const attempt = job.attemptsMade + 1;
      const maxAttempts = job.opts?.attempts ?? 1;

      this.logger.error(
        { ...jobMeta(job), contestId, attempt, maxAttempts, err: error },
        'recheckSubscriptions: error',
      );

      // Есть ещё попытки — отдаём джоб на ретрай, завершение подождёт.
      if (attempt < maxAttempts) throw error;

      // Попытки исчерпаны. Снимаем требование перепроверки, иначе завершение
      // закажет её снова, она снова упадёт, и конкурс застрянет в ACTIVE.
      await this.contestSubscriptionRecheckService.abandonRecheck(contestId);
    }

    await this.contestJobsService.scheduleFinishRetry(contestId, new Date());
  }
}
