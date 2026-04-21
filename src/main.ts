import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as Sentry from '@sentry/node';
import { SentryFilter } from './common/filters/sentry.filter';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ExpressAdapter as BullBoardExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AllExceptionsFilter } from './common/filters/allExceptionsFilter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const serverAdapter = new BullBoardExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  const telegramQueue = app.get<Queue>(getQueueToken('telegram-messages'));
  const contestSchedulerQueue = app.get<Queue>(
    getQueueToken('contest-scheduler'),
  );
  const contestFinishQueue = app.get<Queue>(getQueueToken('contest-finish'));
  const contestPublicationQueue = app.get<Queue>(
    getQueueToken('contest-publication'),
  );
  const contestMaintenanceQueue = app.get<Queue>(
    getQueueToken('contest-maintenance'),
  );

  createBullBoard({
    queues: [
      new BullMQAdapter(telegramQueue),
      new BullMQAdapter(contestSchedulerQueue),
      new BullMQAdapter(contestFinishQueue),
      new BullMQAdapter(contestPublicationQueue),
      new BullMQAdapter(contestMaintenanceQueue),
    ],
    serverAdapter,
  });

  app.use('/admin/queues', serverAdapter.getRouter());
  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // app.useGlobalFilters(new SentryFilter());
  app.use(cookieParser());

  app.useGlobalInterceptors(new ResponseInterceptor());

  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({
    origin: [
      'https://rollcu.ru',
      'https://rollcu.online',
      'https://www.rollcu.ru',
      'https://www.rollcu.online',
    ],
    // origin: true,
    credentials: true,
  });

  app.enableShutdownHooks();

  app.useLogger(app.get(Logger));

  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
  });
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
  });
  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const logger = app.get(Logger);

  logger.log('Health endpoint доступен: http://localhost:3000/health');

  logger.log(
    `Application is running on: http://localhost:${port}`,
    'Bootstrap',
  );

  logger.debug(
    {
      message: 'Application successfully started',
      port,
      env: process.env.NODE_ENV || 'development',
      pid: process.pid,
      uptime: process.uptime(),
    },
    'Bootstrap',
  );
}
void bootstrap();
