// src/health/bullmq.health.ts
import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class BullMQHealthIndicator extends HealthIndicator {
  constructor(@InjectQueue('telegram-messages') private queue: Queue) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // Простая операция, которая проверит соединение и инициализирует очередь
      const counts = await this.queue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
      );

      return this.getStatus(key, true, {
        message: 'BullMQ очередь доступна',
        waiting: counts.waiting,
        active: counts.active,
        completed: counts.completed,
        failed: counts.failed,
      });
    } catch (error) {
      throw new HealthCheckError(
        'BullMQ / Redis проблема',
        this.getStatus(key, false, { error: (error as Error).message }),
      );
    }
  }
}
