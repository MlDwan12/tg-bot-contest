import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ChannelsService } from './services/channels.service';
import { Channel } from './entities';
import { CreateChannelDto, GetChannelsQueryDto } from './dto';
import { Paginated } from 'src/shared/commons/response/paginated.type';
import { JwtAuthGuard } from '../auth/guards';

@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  createChannel(@Body() data: CreateChannelDto): Promise<Channel> {
    return this.channelsService.createChannel(data);
  }

  @Get()
  getAllChannels(
    @Query() query: GetChannelsQueryDto,
  ): Promise<Paginated<Channel>> {
    return this.channelsService.getAllChannels(query);
  }

  @Get(':id')
  getChannelById(@Param('id', ParseIntPipe) id: number): Promise<Channel> {
    return this.channelsService.getChannelById(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  removeChannel(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.channelsService.deleteChannelById(id);
  }
}
