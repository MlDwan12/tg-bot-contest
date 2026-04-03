import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { TypeOrmHealthIndicator } from '@nestjs/terminus';
import { QueuesModule } from 'src/queues';
import { BullMQHealthIndicator } from './bullmq.health';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health';

@Module({
  imports: [TerminusModule, QueuesModule],
  controllers: [HealthController],
  providers: [
    TypeOrmHealthIndicator,
    RedisHealthIndicator,
    BullMQHealthIndicator,
  ],
})
export class HealthModule {}
