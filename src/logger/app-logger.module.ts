import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get('NODE_ENV') === 'production';
        const pretty = config.get<boolean>('LOG_PRETTY', !isProd);
        const redactFromEnv = config
          .get<string>('LOG_REDACT')
          ?.split(',')
          .map((s) => s.trim());

        return {
          pinoHttp: {
            level: config.get<string>('LOG_LEVEL', isProd ? 'info' : 'debug'),
            transport: pretty
              ? {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    singleLine: true,
                    ignore: 'pid,hostname', // можно убрать лишнее
                  },
                }
              : undefined,

            genReqId(req: IncomingMessage, res: ServerResponse) {
              const existing = req.headers['x-request-id'];
              if (existing) return Array.isArray(existing) ? existing[0] : existing;
              const id = randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },

            customLogLevel(
              _req: IncomingMessage,
              res: ServerResponse,
              err?: Error,
            ): 'error' | 'warn' | 'info' | 'debug' {
              if (err || res.statusCode >= 500) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return isProd ? 'info' : 'debug';
            },

            customSuccessMessage(req: IncomingMessage, res: ServerResponse) {
              return `${req.method} ${(req as any).url?.split('?')[0]} ${res.statusCode}`;
            },

            customErrorMessage(req: IncomingMessage, res: ServerResponse) {
              return `${req.method} ${(req as any).url?.split('?')[0]} ${res.statusCode}`;
            },

            autoLogging: {
              ignore: (req: IncomingMessage) => {
                const url = (req as any).url as string | undefined;
                return url === '/health' || url === '/ping';
              },
            },

            redact:
              redactFromEnv ||
              (isProd
                ? [
                    'req.headers.authorization',
                    'req.headers.cookie',
                    'req.body.password',
                    'req.body.token',
                  ]
                : ['req.headers.authorization', 'req.headers.cookie']),

            serializers: {
              req(req: IncomingMessage & { url?: string }) {
                return {
                  method: req.method,
                  url: req.url?.split('?')[0],
                };
              },
              res(res: ServerResponse) {
                return { statusCode: res.statusCode };
              },
            },
          },
        };
      },
    }),
  ],
})
export class AppLoggerModule {}
