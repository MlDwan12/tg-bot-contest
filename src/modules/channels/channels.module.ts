import { forwardRef, Module } from '@nestjs/common';
import { ChannelsService } from './services/channels.service';
import { ChannelsController } from './channels.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from './entities/channel.entity';
import {
  CHANNEL_READ_REPOSITORY,
  CHANNEL_WRITE_REPOSITORY,
} from 'src/shared/commons/constants';
import { ChannelReadRepository, ChannelWriteRepository } from './repositories';
import { BotModule } from '../bot/bot.module';

@Module({
  imports: [TypeOrmModule.forFeature([Channel]), forwardRef(() => BotModule)],
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
  ],
  exports: [ChannelsService],
})
export class ChannelsModule {}
