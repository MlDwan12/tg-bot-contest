import { forwardRef, Module } from '@nestjs/common';
import { ContestsController } from './contests.controller';
import { ContestsService } from './services/contests.service';
import { ContestPublicationService } from './services/contest-publication.service';
import { ContestLifecycleService } from './services/contest-lifecycle.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BotMessage,
  Contest,
  ContestParticipation,
  ContestPublication,
  ContestWinner,
  ContestWinnerAudit,
} from './entities';
import {
  ContestParticipationReadRepository,
  ContestParticipationWriteRepository,
  ContestRepository,
  ContestWinnerReadRepository,
  ContestWinnerWriteRepository,
  ContestWinnerAuditWriteRepository,
} from './repositories';
import {
  CONTEST_PARTICIPATE_READ_REPOSITORY,
  CONTEST_PARTICIPATE_WRITE_REPOSITORY,
  CONTEST_REPOSITORY,
  CONTEST_WINNER_READ_REPOSITORY,
  CONTEST_WINNER_WRITE_REPOSITORY,
} from 'src/common/constants';
import { Channel } from '../channels/entities';
import { UsersModule } from '../users/users.module';
import { ChannelsModule } from '../channels/channels.module';
import { QueuesModule } from 'src/queues';
import {
  ContestsParticipateService,
  ContestWinnerService,
  ContestJobsService,
} from './services';
import { BotModule } from '../bot/bot.module';
import { ContestCountersProcessor } from './jobs/processors';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contest,
      ContestParticipation,
      ContestWinner,
      ContestWinnerAudit,
      ContestPublication,
      BotMessage,
      Channel,
    ]),
    forwardRef(() => UsersModule),
    ChannelsModule,
    QueuesModule,
    BotModule,
    // ContestsJobsModule НЕ импортируем: producer ContestJobsService переехал
    // сюда (в providers), больше брать у jobs нечего. Цикл contests↔jobs разорван.
  ],
  controllers: [ContestsController],
  providers: [
    ContestsService,
    ContestPublicationService,
    ContestLifecycleService,
    ContestsParticipateService,
    ContestWinnerService,
    ContestJobsService,
    ContestCountersProcessor,

    ContestParticipationReadRepository,
    ContestParticipationWriteRepository,
    ContestWinnerReadRepository,
    ContestWinnerWriteRepository,
    ContestWinnerAuditWriteRepository,
    {
      provide: CONTEST_REPOSITORY,
      useClass: ContestRepository,
    },
    {
      provide: CONTEST_PARTICIPATE_READ_REPOSITORY,
      useExisting: ContestParticipationReadRepository,
    },
    {
      provide: CONTEST_PARTICIPATE_WRITE_REPOSITORY,
      useExisting: ContestParticipationWriteRepository,
    },
    {
      provide: CONTEST_WINNER_READ_REPOSITORY,
      useExisting: ContestWinnerReadRepository,
    },
    {
      provide: CONTEST_WINNER_WRITE_REPOSITORY,
      useExisting: ContestWinnerWriteRepository,
    },
  ],
  exports: [
    ContestsService,
    ContestPublicationService,
    ContestLifecycleService,
    CONTEST_REPOSITORY,
    CONTEST_PARTICIPATE_READ_REPOSITORY,
    CONTEST_PARTICIPATE_WRITE_REPOSITORY,
  ],
})
export class ContestsModule {}
