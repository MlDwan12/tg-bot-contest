import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ContestStatus } from 'src/common/enums/contest';
import { CONTEST_REPOSITORY } from 'src/common/constants';
import type { IContestRepository } from '../interfaces';

@Injectable()
export class ContestJobsService implements OnModuleInit {
  constructor(
    @InjectQueue('contest-scheduler') private readonly schedulerQueue: Queue,
    @InjectQueue('contest-finish') private readonly finishQueue: Queue,
    @InjectQueue('contest-maintenance')
    private readonly maintenanceQueue: Queue,
    @Inject(CONTEST_REPOSITORY)
    private readonly contestRepo: IContestRepository,
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

    // Publish-job ставим ВСЕГДА, даже если startDate уже наступил: задержку
    // зажимаем в 0, чтобы джоб отработал немедленно. Он делает и активацию
    // (activateContestIfDue: PENDING→ACTIVE), и публикацию — если пропустить его
    // для уже наступившей даты (напр. при rescheduleContest, где старый job уже
    // снесён), конкурс навсегда зависнет в PENDING. rescheduleFromDb на рестарте
    // использует ту же формулу Math.max(0, ...).
    await this.schedulerQueue.add(
      'publishContest',
      { contestId },
      {
        jobId: publishJobId,
        delay: Math.max(0, startDate.getTime() - now),
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );

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
    const pending = await this.contestRepo.findByStatus(
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

    const active = await this.contestRepo.findByStatus(
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

    // Джобы с продлением дедлайна (scheduleFinishRetry) используют динамический
    // jobId, поэтому их не найти по контестному jobId выше — вычищаем отдельно.
    const delayedFinishJobs = await this.finishQueue.getJobs(['delayed']);
    for (const job of delayedFinishJobs) {
      const data = job.data as { contestId?: number };
      if (data.contestId === contestId) {
        await job.remove();
      }
    }
  }

  // Планирует повторную проверку finishContest на новое время, не трогая
  // текущий (уже активный/заблокированный воркером) job — попытка удалить
  // или переиспользовать его jobId изнутри собственного обработчика
  // проваливается (BullMQ либо кидает "locked by another worker" при remove,
  // либо молча не создаёт новую задачу при add с тем же jobId).
  async scheduleFinishRetry(contestId: number, endDate: Date): Promise<void> {
    const now = Date.now();
    // BullMQ требует, чтобы кастомный jobId с ':' содержал ровно 3 части
    // (обратная совместимость со старым форматом repeatable jobs), иначе
    // add() падает с "Custom Id cannot contain :" — поэтому суффикс без ':'.
    const finishJobId = `contest:${contestId}:finish-retry-${endDate.getTime()}`;

    await this.finishQueue.add(
      'finishContest',
      { contestId },
      {
        jobId: finishJobId,
        delay: Math.max(0, endDate.getTime() - now),
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  }

  async rescheduleContest(
    contestId: number,
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    await this.removeContestJobs(contestId);
    await this.scheduleContest(contestId, startDate, endDate);
  }
}
