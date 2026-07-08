import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validationSchema } from './validation.schema';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppImports } from './modules';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production'
          ? '.env.production'
          : ['.env.local', `.env.${process.env.NODE_ENV || 'development'}`],
      expandVariables: true,
      cache: true,
      validationSchema: validationSchema,
    }),
    // Глобальный лимит: 100 запросов в 60 секунд с одного IP.
    // Чтобы он реально работал — ниже добавлен APP_GUARD с ThrottlerGuard.
    // Без APP_GUARD этот модуль — мёртвый код.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'global',
          ttl: 60,
          limit: 100,
        },
      ],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return {
          type: 'postgres' as const,
          host: configService.get<string>('DATABASE_HOST'),
          port: configService.get<number>('DATABASE_PORT'),
          username: configService.get<string>('DATABASE_USER'),
          password: configService.get<string>('DATABASE_PASSWORD'),
          database: configService.get<string>('DATABASE_NAME'),
          schema: configService.get<string>('DATABASE_SCHEMA', 'public'),
          extra: {
            max: 40,
            min: 5,
            idleTimeoutMillis: 60000,
            connectionTimeoutMillis: 1000,
          },
          autoLoadEntities: true,
          synchronize: false,

          // logging:
          //   configService.get('NODE_ENV') !== 'production'
          //     ? ['query', 'error']
          //     : ['error'],

          // Миграции — запускаем вручную (не автозапуск)
          migrations: [__dirname + '/migrations/*{.ts,.js}'],
          migrationsRun: false, // true только если хочешь автозапуск при старте (редко)
        };
      },
    }),
    ScheduleModule.forRoot(),
    ...AppImports,
  ],
  providers: [
    // APP_GUARD — это специальный токен NestJS для глобальных guard'ов.
    // ThrottlerGuard применяется ко ВСЕМ роутам автоматически.
    // На конкретных роутах можно переопределить через @Throttle()
    // или отключить через @SkipThrottle().
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppConfigModule {}
