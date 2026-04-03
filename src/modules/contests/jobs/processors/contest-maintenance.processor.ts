import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { ContestWriteRepository } from '../../repositories';
import { Logger } from 'nestjs-pino';
import { jobMeta } from 'src/common/helpers/job-meta.helper';

type MaintenanceJobData = { staleMinutes?: number } | { batchSize?: number };

@Processor('contest-maintenance')
export class ContestMaintenanceProcessor extends WorkerHost {
  constructor(
    private readonly contestWriteRepo: ContestWriteRepository,
    @InjectQueue('contest-publication')
    private readonly publicationQueue: Queue,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<MaintenanceJobData>) {
    // ✅ Ветка 1: requeue
    if (job.name === 'requeueStalePublications') {
      const staleMinutes =
        'staleMinutes' in (job.data ?? {})
          ? ((job.data as any).staleMinutes ?? 10)
          : 10;

      this.logger.debug(
        { ...jobMeta(job), staleMinutes },
        'maintenance: start',
      );

      try {
        const affected =
          await this.contestWriteRepo.requeueStalePublications(staleMinutes);

        if (affected > 0) {
          this.logger.warn(
            { ...jobMeta(job), staleMinutes, affected },
            'maintenance: requeued stale publications',
          );
        } else {
          this.logger.debug(
            { ...jobMeta(job), staleMinutes, affected },
            'maintenance: nothing to requeue',
          );
        }
        return;
      } catch (e: any) {
        this.logger.error(
          { ...jobMeta(job), staleMinutes, err: e?.message ?? e },
          'maintenance: error',
        );
        throw e;
      }
    }

    // ✅ Ветка 2: enqueue missing pending публикаций
    if (job.name === 'enqueuePendingPublications') {
      const batchSize =
        'batchSize' in (job.data ?? {})
          ? ((job.data as any).batchSize ?? 500)
          : 500;

      this.logger.debug(
        { ...jobMeta(job), batchSize },
        'maintenance: enqueue start',
      );

      const ids =
        await this.contestWriteRepo.findPendingPublicationIdsForActiveContests(
          batchSize,
        );

      if (!ids.length) {
        this.logger.debug(
          { ...jobMeta(job), batchSize },
          'maintenance: enqueue nothing to add',
        );
        return;
      }

      const jobs = ids.map((publicationId) => ({
        name: 'sendPublication',
        data: { publicationId },
        opts: { jobId: `publication:${publicationId}:send` },
      }));

      try {
        await this.publicationQueue.addBulk(jobs);
      } catch (e: any) {
        this.logger.warn(
          { err: e?.message ?? e },
          'addBulk failed, fallback to single add',
        );

        // fallback по одному
        for (const job of jobs) {
          try {
            await this.publicationQueue.add(job.name, job.data, job.opts);
          } catch (err: any) {
            const msg = String(err?.message ?? err);
            if (msg.includes('already exists')) continue;
            throw err;
          }
        }
      }

      //   for (const publicationId of ids) {
      //     try {
      //       await this.publicationQueue.add(
      //         'sendPublication',
      //         { publicationId },
      //         { jobId: `publication:${publicationId}:send` },
      //       );
      //       added++;
      //     } catch (e: any) {
      //       const msg = String(e?.message ?? e);
      //       if (msg.includes('Job already exists')) {
      //         skipped++;
      //         continue;
      //       }
      //       throw e;
      //     }
      //   }

      this.logger.debug(
        { ...jobMeta(job), fetched: ids.length },
        'maintenance: enqueue done',
      );
      return;
    }

    // неизвестный job — игнор
    return;
  }
}
