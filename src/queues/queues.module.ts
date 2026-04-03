import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueuesMonitoringModule } from './monitoring/queues-monitoring.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          db: config.get<number>('REDIS_DB', 0),
        },
        defaultJobOptions: {
          attempts: 3, // попытки при ошибке
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 1000, // чистить завершённые
          removeOnFail: 5000, // храним последние 100 фейлов
        },
      }),
    }),
    BullModule.registerQueue(
      {
        name: 'telegram-messages',
      },
      {
        name: 'contest-scheduler',
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 1000 },
        },
      },
      {
        name: 'contest-finish',
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 1000 },
        },
      },
      {
        name: 'contest-publication',
        defaultJobOptions: {
          attempts: 10,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 2000,
          removeOnFail: 10000,
        },
      },
      { name: 'contest-maintenance' },
      {
        name: 'contest-counters',
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 2000,
          removeOnFail: 10000,
        },
      },
    ),
    QueuesMonitoringModule,
  ],
  exports: [BullModule],
})
export class QueuesModule {}
