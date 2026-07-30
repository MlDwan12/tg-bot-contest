// src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckResult,
} from '@nestjs/terminus';
import { TypeOrmHealthIndicator } from '@nestjs/terminus';
import { BullMQHealthIndicator } from './bullmq.health';
import { RedisHealthIndicator } from './redis.health';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

// Load balancers, k8s liveness probes и мониторинг пингуют /health
// каждые 10-30 секунд — без SkipThrottle они получат 429 и вызовут
// ложные алерты "сервис недоступен".
@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private redisIndicator: RedisHealthIndicator,
    private bullmqIndicator: BullMQHealthIndicator,
  ) {}

  @ApiOperation({
    summary: 'Проверка живости',
    description:
      'Postgres + Redis + очереди BullMQ. 200 — всё живо, 503 — что-то из ' +
      'трёх недоступно (тело ответа — стандартный формат @nestjs/terminus, ' +
      'но тоже обёрнут в {success,status,data} общим ResponseInterceptor).',
  })
  @ApiResponse({ status: 200, description: 'Все проверки прошли' })
  @ApiResponse({ status: 503, description: 'Одна из зависимостей недоступна' })
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
