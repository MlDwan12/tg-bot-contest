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
  ContestParticipationRepository,
  ContestRepository,
  ContestWinnerRepository,
  ContestWinnerAuditWriteRepository,
  BotMessageRepository,
} from './repositories';
import {
  BOT_MESSAGE_REPOSITORY,
  CONTEST_PARTICIPATE_REPOSITORY,
  CONTEST_REPOSITORY,
  CONTEST_WINNER_REPOSITORY,
} from 'src/common/constants';
import { Channel } from '../channels/entities';
import { UsersModule } from '../users/users.module';
import { ChannelsModule } from '../channels/channels.module';
import { QueuesModule } from 'src/queues';
import {
  ContestsParticipateService,
  ContestWinnerService,
  ContestJobsService,
  ContestWinnerNotifyService,
  ContestSubscriptionRecheckService,
  ContestStatsService,
} from './services';
import { BotModule } from '../bot/bot.module';
import {
  ContestCountersProcessor,
  ContestWinnerNotifyProcessor,
} from './jobs/processors';

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
    ContestWinnerNotifyService,
    ContestSubscriptionRecheckService,
    ContestStatsService,
    ContestJobsService,
    ContestCountersProcessor,
    ContestWinnerNotifyProcessor,

    ContestWinnerAuditWriteRepository,
    {
      provide: CONTEST_REPOSITORY,
      useClass: ContestRepository,
    },
    {
      provide: CONTEST_PARTICIPATE_REPOSITORY,
      useClass: ContestParticipationRepository,
    },
    {
      provide: CONTEST_WINNER_REPOSITORY,
      useClass: ContestWinnerRepository,
    },
    {
      provide: BOT_MESSAGE_REPOSITORY,
      useClass: BotMessageRepository,
    },
  ],
  exports: [
    ContestsService,
    ContestPublicationService,
    ContestLifecycleService,
    // Нужны ContestFinishProcessor из ContestsJobsModule: он ведёт двухфазное
    // завершение — заказывает перепроверку подписок и переставляет финиш.
    ContestSubscriptionRecheckService,
    ContestJobsService,
    CONTEST_REPOSITORY,
    CONTEST_PARTICIPATE_REPOSITORY,
  ],
})
export class ContestsModule {}
