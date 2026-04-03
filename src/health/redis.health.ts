import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@InjectQueue('telegram-messages') private queue: Queue) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const redisClient = this.queue.client;
      const pong = await (await redisClient).ping();

      if (pong !== 'PONG') {
        throw new Error('Unexpected ping response');
      }

      return this.getStatus(key, true, { message: 'Redis ping OK' });
    } catch (error) {
      throw new HealthCheckError(
        'Redis недоступен',
        this.getStatus(key, false, { error: (error as Error).message }),
      );
    }
  }
}
