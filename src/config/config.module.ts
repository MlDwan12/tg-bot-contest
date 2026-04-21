import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validationSchema } from './validation.schema';
import { ThrottlerModule } from '@nestjs/throttler';
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
    ThrottlerModule.forRoot({
      throttlers: [
        {
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
})
export class AppConfigModule {}
