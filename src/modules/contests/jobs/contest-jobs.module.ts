import { Module } from '@nestjs/common';
import { QueuesModule } from 'src/queues/queues.module';
import { ContestsModule } from '../contests.module';
import { BotModule } from 'src/modules/bot/bot.module';
import {
  ContestPublishProcessor,
  ContestPublicationProcessor,
  ContestFinishProcessor,
} from './processors';

@Module({
  imports: [
    QueuesModule,
    // Обычный импорт (не forwardRef): цикл contests↔jobs разорван — producer
    // ContestJobsService переехал в ContestsModule, jobs зависит от contests
    // односторонне (процессоры-потребители тянут сервисы contests).
    ContestsModule,
    BotModule,
  ],
  providers: [
    ContestPublishProcessor,
    ContestPublicationProcessor,
    ContestFinishProcessor,
  ],
})
export class ContestsJobsModule {}
