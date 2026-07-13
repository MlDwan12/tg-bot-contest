import { Module } from '@nestjs/common';
import { ChannelsService } from './services/channels.service';
import { ChannelsController } from './channels.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from './entities/channel.entity';
import {
  CHANNEL_READ_REPOSITORY,
  CHANNEL_WRITE_REPOSITORY,
} from 'src/common/constants';
import { ChannelReadRepository, ChannelWriteRepository } from './repositories';
import { BotModule } from '../bot/bot.module';
import { ChannelHealthService } from './services/health.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Channel]),
    BotModule,
    // AuthModule НЕ импортируем: он @Global, JwtAuthGuard доступен глобально
    // (как в contests.controller). Импорт был избыточен и замыкал ложный цикл.
  ],
  controllers: [ChannelsController],
  providers: [
    ChannelsService,
    {
      provide: CHANNEL_READ_REPOSITORY,
      useClass: ChannelReadRepository,
    },
    {
      provide: CHANNEL_WRITE_REPOSITORY,
      useClass: ChannelWriteRepository,
    },
    ChannelHealthService,
  ],
  exports: [ChannelsService],
})
export class ChannelsModule {}
