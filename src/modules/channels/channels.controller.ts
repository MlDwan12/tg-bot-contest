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
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiEnvelopedPaginatedResponse,
  ApiEnvelopedResponse,
  ApiEnvelopedResponseRaw,
} from 'src/common/swagger/api-enveloped-response.decorator';

@ApiTags('channels')
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @ApiOperation({
    summary: 'Привязать канал',
    description:
      'Принимает и старый Telegram-контракт (telegramId/telegramUsername), ' +
      'и новый (platform+externalId) — переходный период миграции на MAX. ' +
      'Нормализация в ChannelsService.resolveExternalIdentity.',
  })
  @ApiCookieAuth('accessToken')
  @ApiEnvelopedResponse(ChannelResponseDto, { status: 201 })
  @Post()
  @UseGuards(JwtAuthGuard)
  async createChannel(
    @Body() data: CreateChannelDto,
  ): Promise<ChannelResponseDto> {
    const channel = await this.channelsService.createChannel(data);
    return ChannelResponseDto.fromEntity(channel);
  }

  @ApiOperation({
    summary: 'Список каналов',
    description: 'Постранично, с фильтром по типу и активности.',
  })
  @ApiEnvelopedPaginatedResponse(ChannelResponseDto)
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

  @ApiOperation({ summary: 'Канал по id' })
  @ApiParam({ name: 'id', type: Number })
  @ApiEnvelopedResponse(ChannelResponseDto)
  @Get(':id')
  async getChannelById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ChannelResponseDto> {
    const channel = await this.channelsService.getChannelById(id);
    return ChannelResponseDto.fromEntity(channel);
  }

  @ApiOperation({ summary: 'Отвязать канал' })
  @ApiCookieAuth('accessToken')
  @ApiParam({ name: 'id', type: Number })
  @ApiEnvelopedResponseRaw({ type: 'null' })
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  removeChannel(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.channelsService.deleteChannelById(id);
  }
}
