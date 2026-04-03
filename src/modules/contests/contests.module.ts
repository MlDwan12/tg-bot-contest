import { forwardRef, Module } from '@nestjs/common';
import { ContestsController } from './contests.controller';
import { ContestsService } from './services/contests.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BotMessage,
  Contest,
  ContestParticipation,
  ContestPublication,
  ContestWinner,
} from './entities';
import {
  ContestParticipationReadRepository,
  ContestParticipationWriteRepository,
  ContestReadRepository,
  ContestWinnerReadRepository,
  ContestWinnerWriteRepository,
  ContestWriteRepository,
} from './repositories';
import {
  CONTEST_PARTICIPATE_READ_REPOSITORY,
  CONTEST_PARTICIPATE_WRITE_REPOSITORY,
  CONTEST_READ_REPOSITORY,
  CONTEST_WINNER_READ_REPOSITORY,
  CONTEST_WINNER_WRITE_REPOSITORY,
  CONTEST_WRITE_REPOSITORY,
} from 'src/shared/commons/constants';
import { Channel } from '../channels/entities';
import { UsersModule } from '../users/users.module';
import { ChannelsModule } from '../channels/channels.module';
import { ContestsJobsModule } from './jobs/contest-jobs.module';
import { QueuesModule } from 'src/queues';
import { ContestsParticipateService, ContestWinnerService } from './services';
import { BotModule } from '../bot/bot.module';
import { ContestCountersProcessor } from './jobs/processors';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contest,
      ContestParticipation,
      ContestWinner,
      ContestPublication,
      BotMessage,
      Channel,
    ]),
    forwardRef(() => UsersModule),
    forwardRef(() => ChannelsModule),
    QueuesModule,
    forwardRef(() => BotModule),
    forwardRef(() => ContestsJobsModule),
  ],
  controllers: [ContestsController],
  // providers: [
  //   ContestsService,
  //   ContestsParticipateService,
  //   ContestWinnerService,
  //   {
  //     provide: CONTEST_READ_REPOSITORY,
  //     useClass: ContestReadRepository,
  //   },
  //   {
  //     provide: CONTEST_WRITE_REPOSITORY,
  //     useClass: ContestWriteRepository,
  //   },

  //   {
  //     provide: CONTEST_PARTICIPATE_READ_REPOSITORY,
  //     useClass: ContestParticipationReadRepository,
  //   },
  //   {
  //     provide: CONTEST_PARTICIPATE_WRITE_REPOSITORY,
  //     useClass: ContestParticipationWriteRepository,
  //   },

  //   {
  //     provide: CONTEST_WINNER_READ_REPOSITORY,
  //     useClass: ContestWinnerReadRepository,
  //   },

  //   {
  //     provide: CONTEST_WINNER_WRITE_REPOSITORY,
  //     useClass: ContestWinnerWriteRepository,
  //   },
  // ],

  providers: [
    ContestsService,
    ContestsParticipateService,
    ContestWinnerService,
    ContestCountersProcessor,

    ContestReadRepository,
    ContestWriteRepository,
    ContestParticipationReadRepository,
    ContestParticipationWriteRepository,
    ContestWinnerReadRepository,
    ContestWinnerWriteRepository,

    {
      provide: CONTEST_READ_REPOSITORY,
      useExisting: ContestReadRepository,
    },
    {
      provide: CONTEST_WRITE_REPOSITORY,
      useExisting: ContestWriteRepository,
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
    CONTEST_READ_REPOSITORY,
    CONTEST_WRITE_REPOSITORY,
    CONTEST_PARTICIPATE_READ_REPOSITORY,
    CONTEST_PARTICIPATE_WRITE_REPOSITORY,
  ],
})
export class ContestsModule {}
