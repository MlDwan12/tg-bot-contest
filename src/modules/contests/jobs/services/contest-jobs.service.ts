import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ContestStatus } from 'src/shared/enums/contest';
import { CONTEST_READ_REPOSITORY } from 'src/shared/commons/constants';
import type { IContestReadRepository } from '../../interfaces';

@Injectable()
export class ContestJobsService implements OnModuleInit {
  constructor(
    @InjectQueue('contest-scheduler') private readonly schedulerQueue: Queue,
    @InjectQueue('contest-finish') private readonly finishQueue: Queue,
    @InjectQueue('contest-maintenance')
    private readonly maintenanceQueue: Queue,
    @Inject(CONTEST_READ_REPOSITORY)
    private readonly contestReadRepo: IContestReadRepository,
  ) {}

  async onModuleInit() {
    await this.startMaintenance();
    await this.rescheduleFromDb();
  }

  async scheduleContest(contestId: number, startDate: Date, endDate: Date) {
    const now = Date.now();
    // const startDelay = Math.max(0, startDate.getTime() - now);
    // const endDelay = Math.max(0, endDate.getTime() - now);

    const publishJobId = `contest:${contestId}:publish`;
    const finishJobId = `contest:${contestId}:finish`;

    const existingPublishJob = await this.schedulerQueue.getJob(publishJobId);
    if (existingPublishJob) {
      await existingPublishJob.remove();
    }

    const existingFinishJob = await this.finishQueue.getJob(finishJobId);
    if (existingFinishJob) {
      await existingFinishJob.remove();
    }

    if (startDate.getTime() > now) {
      await this.schedulerQueue.add(
        'publishContest',
        { contestId },
        {
          jobId: publishJobId,
          delay: startDate.getTime() - now,
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
    }

    if (endDate.getTime() > now) {
      await this.finishQueue.add(
        'finishContest',
        { contestId },
        {
          jobId: finishJobId,
          delay: endDate.getTime() - now,
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
    }

    // await this.schedulerQueue.add(
    //   'publishContest',
    //   { contestId },
    //   { jobId: `contest:${contestId}:publish`, delay: startDelay },
    // );

    // await this.finishQueue.add(
    //   'finishContest',
    //   { contestId },
    //   { jobId: `contest:${contestId}:finish`, delay: endDelay },
    // );
  }

  private async startMaintenance() {
    await this.maintenanceQueue.add(
      'requeueStalePublications',
      { staleMinutes: 10 },
      {
        jobId: 'maintenance:requeue-stale-publications',
        repeat: { every: 60_000 },
      },
    );

    await this.maintenanceQueue.add(
      'enqueuePendingPublications',
      { batchSize: 500 },
      {
        jobId: 'maintenance:enqueue-pending-publications',
        repeat: { every: 60_000 },
      },
    );
  }
  private async rescheduleFromDb() {
    const pending = await this.contestReadRepo.findByStatus(
      ContestStatus.PENDING,
    );

    for (const c of pending) {
      const publishJobId = `contest:${c.id}:publish`;
      const exists = await this.schedulerQueue.getJob(publishJobId);
      if (!exists) {
        const delay = Math.max(0, c.startDate.getTime() - Date.now());
        await this.schedulerQueue.add(
          'publishContest',
          { contestId: c.id },
          { jobId: publishJobId, delay },
        );
      }

      const finishJobId = `contest:${c.id}:finish`;
      const finishExists = await this.finishQueue.getJob(finishJobId);
      if (!finishExists) {
        const delay = Math.max(0, c.endDate.getTime() - Date.now());
        await this.finishQueue.add(
          'finishContest',
          { contestId: c.id },
          { jobId: finishJobId, delay },
        );
      }
    }

    const active = await this.contestReadRepo.findByStatus(
      ContestStatus.ACTIVE,
    );

    for (const c of active) {
      const finishJobId = `contest:${c.id}:finish`;
      const exists = await this.finishQueue.getJob(finishJobId);
      if (!exists) {
        const delay = Math.max(0, c.endDate.getTime() - Date.now());
        await this.finishQueue.add(
          'finishContest',
          { contestId: c.id },
          { jobId: finishJobId, delay },
        );
      }
    }
  }

  async removeContestJobs(contestId: number): Promise<void> {
    const publishJobId = `contest:${contestId}:publish`;
    const finishJobId = `contest:${contestId}:finish`;

    const publishJob = await this.schedulerQueue.getJob(publishJobId);
    if (publishJob) {
      await publishJob.remove();
    }

    const finishJob = await this.finishQueue.getJob(finishJobId);
    if (finishJob) {
      await finishJob.remove();
    }
  }
}
