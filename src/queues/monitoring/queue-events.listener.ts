import * as Sentry from '@sentry/node';
import { Injectable, Logger } from '@nestjs/common';
import {
  QueueEventsHost,
  QueueEventsListener,
  OnQueueEvent,
} from '@nestjs/bullmq';

@Injectable()
@QueueEventsListener('telegram-messages')
export class TelegramMessagesQueueEventsListener extends QueueEventsHost {
  private readonly logger = new Logger(
    TelegramMessagesQueueEventsListener.name,
  );

  @OnQueueEvent('failed')
  onFailed(args: { jobId: string; failedReason?: string; prev?: string }) {
    this.logger.error(
      `Queue telegram-messages job failed: ${JSON.stringify(args)}`,
    );

    Sentry.withScope((scope) => {
      scope.setTag('queue', 'telegram-messages');
      scope.setContext('bullmq', args);
      Sentry.captureMessage(
        `BullMQ failed: telegram-messages jobId=${args.jobId} reason=${args.failedReason}`,
        'error',
      );
    });
  }
}

@Injectable()
@QueueEventsListener('contest-scheduler')
export class ContestSchedulerQueueEventsListener extends QueueEventsHost {
  private readonly logger = new Logger(
    ContestSchedulerQueueEventsListener.name,
  );

  @OnQueueEvent('failed')
  onFailed(args: { jobId: string; failedReason?: string; prev?: string }) {
    this.logger.error(
      `Queue contest-scheduler job failed: ${JSON.stringify(args)}`,
    );

    Sentry.withScope((scope) => {
      scope.setTag('queue', 'contest-scheduler');
      scope.setContext('bullmq', args);
      Sentry.captureMessage(
        `BullMQ failed: contest-scheduler jobId=${args.jobId} reason=${args.failedReason}`,
        'error',
      );
    });
  }
}

@Injectable()
@QueueEventsListener('contest-finish')
export class ContestFinishQueueEventsListener extends QueueEventsHost {
  private readonly logger = new Logger(ContestFinishQueueEventsListener.name);

  @OnQueueEvent('failed')
  onFailed(args: { jobId: string; failedReason?: string; prev?: string }) {
    this.logger.error(
      `Queue contest-finish job failed: ${JSON.stringify(args)}`,
    );

    Sentry.withScope((scope) => {
      scope.setTag('queue', 'contest-finish');
      scope.setContext('bullmq', args);
      Sentry.captureMessage(
        `BullMQ failed: contest-finish jobId=${args.jobId} reason=${args.failedReason}`,
        'error',
      );
    });
  }
}

@Injectable()
@QueueEventsListener('contest-publication')
export class ContestPublicationQueueEventsListener extends QueueEventsHost {
  private readonly logger = new Logger(
    ContestPublicationQueueEventsListener.name,
  );

  @OnQueueEvent('failed')
  onFailed(args: { jobId: string; failedReason?: string; prev?: string }) {
    this.logger.error(
      `Queue contest-publication job failed: ${JSON.stringify(args)}`,
    );

    Sentry.withScope((scope) => {
      scope.setTag('queue', 'contest-publication');
      scope.setContext('bullmq', args);
      Sentry.captureMessage(
        `BullMQ failed: contest-publication jobId=${args.jobId} reason=${args.failedReason}`,
        'error',
      );
    });
  }
}

@Injectable()
@QueueEventsListener('contest-maintenance')
export class ContestMaintenanceQueueEventsListener extends QueueEventsHost {
  private readonly logger = new Logger(
    ContestMaintenanceQueueEventsListener.name,
  );

  @OnQueueEvent('failed')
  onFailed(args: { jobId: string; failedReason?: string; prev?: string }) {
    this.logger.error(
      `Queue contest-maintenance job failed: ${JSON.stringify(args)}`,
    );

    Sentry.withScope((scope) => {
      scope.setTag('queue', 'contest-maintenance');
      scope.setContext('bullmq', args);
      Sentry.captureMessage(
        `BullMQ failed: contest-maintenance jobId=${args.jobId} reason=${args.failedReason}`,
        'error',
      );
    });
  }
}
