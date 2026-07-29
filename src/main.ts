import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as Sentry from '@sentry/node';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ExpressAdapter as BullBoardExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AllExceptionsFilter } from './common/filters/allExceptionsFilter';
import * as jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // cookieParser должен быть зарегистрирован ДО любого middleware,
  // которому нужны куки — иначе req.cookies будет undefined.
  app.use(cookieParser());

  // Отключаем ETag — иначе Express отвечает 304 Not Modified на повторные
  // запросы с одинаковым телом, что сбивает клиентов и замусоривает логи.
  app.set('etag', false);

  const serverAdapter = new BullBoardExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  // Список очередей держим одним массивом: раньше он был набором отдельных
  // переменных, и новые очереди в дашборд просто не попадали — contest-counters,
  // contest-winner-notify, contest-winner-confirm и user-mailing отсутствовали,
  // а именно в них живут уведомления победителей и дедлайны подтверждения.
  const MONITORED_QUEUES = [
    'telegram-messages',
    'contest-scheduler',
    'contest-finish',
    'contest-publication',
    'contest-maintenance',
    'contest-counters',
    'contest-winner-notify',
    'contest-winner-confirm',
    'user-mailing',
  ];

  createBullBoard({
    queues: MONITORED_QUEUES.map(
      (name) => new BullMQAdapter(app.get<Queue>(getQueueToken(name))),
    ),
    serverAdapter,
  });

  // Защита Bull Board: проверяем JWT из cookie напрямую через jsonwebtoken,
  // так как на этом уровне мы вне NestJS DI и JwtAuthGuard недоступен.
  // Используем тот же JWT_ACCESS_SECRET что и остальное приложение —
  // никакого дублирования логики, единый источник истины.
  app.use(
    '/admin/queues',
    (req: Request, res: Response, next: NextFunction) => {
      const token = req.cookies?.accessToken as string | undefined;

      if (!token) {
        res.status(401).json({ message: 'Unauthorized: no session' });
        return;
      }

      try {
        const secret = process.env.JWT_ACCESS_SECRET;
        if (!secret) {
          res.status(500).json({ message: 'Server misconfiguration' });
          return;
        }

        const payload = jwt.verify(token, secret) as { role?: string };

        // Только администраторы могут видеть очереди.
        // Обычные пользователи с role='user' получают 403.
        if (payload?.role !== 'admin') {
          res.status(403).json({ message: 'Forbidden: admin only' });
          return;
        }

        next();
      } catch {
        // JWT просрочен или подделан
        res.status(401).json({ message: 'Unauthorized: invalid session' });
      }
    },
  );

  app.use('/admin/queues', serverAdapter.getRouter());
  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(new ResponseInterceptor());

  // AllExceptionsFilter — единый глобальный фильтр: единый конверт ответа
  // + отправка 5xx/необработанных в Sentry (см. сам фильтр).
  app.useGlobalFilters(new AllExceptionsFilter());

  // Разрешённые origin'ы — из env (CORS_ORIGINS, список через запятую).
  // Фолбэк на прежний захардкоженный список, чтобы поведение не менялось,
  // если переменная не задана.
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [
        'https://rollcu.ru',
        'https://rollcu.online',
        'https://www.rollcu.ru',
        'https://www.rollcu.online',
      ];

  app.enableCors({
    origin: corsOrigins,
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
