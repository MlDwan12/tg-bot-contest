import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IncomingMessage } from 'http';
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get('NODE_ENV') === 'production';
        const pretty = config.get<boolean>('LOG_PRETTY', !isProd);

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

            redact: config.get<string>('LOG_REDACT')?.split(',') || [
              'req.headers.authorization',
              'req.headers.cookie',
            ],

            autoLogging: true, // логирует req/res автоматически
            serializers: {
              req(req: IncomingMessage & { url?: string }) {
                if (req.url) {
                  req.url = req.url.split('?')[0]; // скрываем query
                }
                return req;
              },
            },
          },
        };
      },
    }),
  ],
})
export class AppLoggerModule {}
