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
import {
  ChannelResponseDto,
  CreateChannelDto,
  GetChannelsQueryDto,
} from './dto';
import { Paginated } from 'src/common/response/paginated.type';
import { JwtAuthGuard } from '../auth/guards';

@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async createChannel(
    @Body() data: CreateChannelDto,
  ): Promise<ChannelResponseDto> {
    const channel = await this.channelsService.createChannel(data);
    return ChannelResponseDto.fromEntity(channel);
  }

  @Get()
  async getAllChannels(
    @Query() query: GetChannelsQueryDto,
  ): Promise<Paginated<ChannelResponseDto>> {
    const result = await this.channelsService.getAllChannels(query);
    return {
      ...result,
      items: result.items.map(ChannelResponseDto.fromEntity),
    };
  }

  @Get(':id')
  async getChannelById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ChannelResponseDto> {
    const channel = await this.channelsService.getChannelById(id);
    return ChannelResponseDto.fromEntity(channel);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  removeChannel(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.channelsService.deleteChannelById(id);
  }
}
