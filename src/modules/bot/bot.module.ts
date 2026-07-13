import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { BotUpdate } from './bot.update';
import { validationSchema } from 'src/config';
import { TelegramService } from './bot.service';
import { ContestsModule } from '../contests/contests.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema,
    }),
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const token = configService.get<string>('TELEGRAM_BOT_TOKEN');
        if (!token) {
          throw new Error('TELEGRAM_BOT_TOKEN is not defined in .env');
        }
        return { token };
      },
    }),
    forwardRef(() => ContestsModule),
    // ChannelsModule НЕ импортируем: bot ничего из channels не использует
    // (был мёртвый импорт, замыкал прямой цикл bot↔channels). Обратная связь
    // channels→bot (TelegramService) остаётся — она реальна.
  ],
  providers: [BotUpdate, TelegramService],
  exports: [BotUpdate, TelegramService],
})
export class BotModule {}
