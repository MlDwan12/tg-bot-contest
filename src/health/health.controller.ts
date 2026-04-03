// src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckResult,
} from '@nestjs/terminus';
import { TypeOrmHealthIndicator } from '@nestjs/terminus';
import { BullMQHealthIndicator } from './bullmq.health';
import { RedisHealthIndicator } from './redis.health';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private redisIndicator: RedisHealthIndicator,
    private bullmqIndicator: BullMQHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      // PostgreSQL / TypeORM
      () => this.db.pingCheck('database', { timeout: 300 }),

      // Redis (через кастомный индикатор)
      () => this.redisIndicator.isHealthy('redis'),

      // BullMQ очереди (проверка соединения с Redis + готовность очередей)
      () => this.bullmqIndicator.isHealthy('bullmq'),
    ]);
  }
}
