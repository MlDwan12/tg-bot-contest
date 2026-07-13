import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { BotUpdate } from './bot.update';
import { validationSchema } from 'src/config';
import { TelegramService } from './bot.service';

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
    // bot — ЛИСТ графа: не импортирует ни contests, ни channels.
    // bot↔contests разорван (ContestPublicationService больше не инъектится:
    // deletePublicationMessages принимает данные параметром). Обратные связи
    // *→bot (TelegramService) реальны и односторонни.
  ],
  providers: [BotUpdate, TelegramService],
  exports: [BotUpdate, TelegramService],
})
export class BotModule {}
