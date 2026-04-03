import { HealthModule } from 'src/health';
import { AppLoggerModule } from 'src/logger';
import { AuthModule } from 'src/modules/auth/auth.module';
import { BotModule } from 'src/modules/bot/bot.module';
import { ChannelsModule } from 'src/modules/channels/channels.module';
import { ContestsModule } from 'src/modules/contests/contests.module';
import { ContestsJobsModule } from 'src/modules/contests/jobs/contest-jobs.module';
import { UsersModule } from 'src/modules/users/users.module';
import { QueuesModule } from 'src/queues';

export const AppImports = [
  AppLoggerModule,
  QueuesModule,
  HealthModule,
  UsersModule,
  ContestsModule,
  ChannelsModule,
  BotModule,
  AuthModule,
  ContestsJobsModule,
];
