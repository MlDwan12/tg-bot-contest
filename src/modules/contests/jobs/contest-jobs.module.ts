import { forwardRef, Module } from '@nestjs/common';
import { QueuesModule } from 'src/queues/queues.module';
import { ContestsModule } from '../contests.module';
import { BotModule } from 'src/modules/bot/bot.module';
import { ContestJobsService } from './services';
import {
  ContestPublishProcessor,
  ContestPublicationProcessor,
  ContestFinishProcessor,
} from './processors';

@Module({
  imports: [
    QueuesModule,
    forwardRef(() => ContestsModule),
    forwardRef(() => BotModule),
  ],
  providers: [
    ContestJobsService,
    ContestPublishProcessor,
    ContestPublicationProcessor,
    ContestFinishProcessor,
  ],
  exports: [ContestJobsService],
})
export class ContestsJobsModule {}
