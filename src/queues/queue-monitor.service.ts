import { Injectable, OnModuleInit } from '@nestjs/common';

@Injectable()
export class QueueMonitorService implements OnModuleInit {
  constructor() {
    // ВСТАВЬ СЮДА СВОИ очереди через DI
    // пример:
    // @InjectQueue('publication') private publicationQueue: Queue,
  }

  onModuleInit() {
    // Пример: подписка на события очереди
    // this.publicationQueue.on('failed', (job, err) => {
    //   Sentry.withScope((scope) => {
    //     scope.setTag('queue', 'publication');
    //     scope.setContext('job', {
    //       id: job?.id,
    //       name: job?.name,
    //       data: job?.data,
    //       attemptsMade: job?.attemptsMade,
    //     });
    //     Sentry.captureException(err);
    //   });
    // });
  }
}
