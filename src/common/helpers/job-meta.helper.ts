import { Job } from 'bullmq';

export function jobMeta(job: Job) {
  return {
    jobId: job.id,
    name: job.name,
    queue: job.queueName,
    attemptsMade: job.attemptsMade,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    data: job.data,
  };
}
