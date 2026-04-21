import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CHANNEL_READ_REPOSITORY,
  CHANNEL_WRITE_REPOSITORY,
} from 'src/shared/commons/constants';

import { ChannelType } from 'src/shared/enums/channel';
import { Channel } from '../entities';
import { ChannelReadRepository, ChannelWriteRepository } from '../repositories';
import { TelegramService } from 'src/modules/bot/bot.service';
import { Logger } from 'nestjs-pino';
import { Paginated } from 'src/shared/commons/response/paginated.type';
import { buildPaginatedResponse } from 'src/common/helpers/paginatedResponse.helper';
import { getPaginationParams } from 'src/common/helpers/paginationParams.helper';
import { FindOptionsWhere } from 'typeorm';

@Injectable()
export class ChannelsService {
  constructor(
    @Inject(CHANNEL_READ_REPOSITORY)
    private readonly readRepo: ChannelReadRepository,

    @Inject(CHANNEL_WRITE_REPOSITORY)
    private readonly writeRepo: ChannelWriteRepository,

    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    private readonly logger: Logger,
  ) {}

  async createChannel(data: {
    telegramId: number;
    telegramUsername?: string;
    name?: string;
    type?: ChannelType;
  }): Promise<Channel> {
    try {
      this.logger.log({ data }, 'Create channel request');

      if (!data.telegramId && !data.telegramUsername) {
        throw new BadRequestException(
          'telegramId or telegramUsername is required',
        );
      }

      if (data.telegramId) {
        const exists = await this.readRepo.findByTelegramId(data.telegramId);

        if (exists) {
          throw new BadRequestException(
            'Channel with this telegramId already exists',
          );
        }
      }
      console.log(data.telegramId);

      const chatId =
        data.telegramId ??
        (data.telegramUsername
          ? `@${data.telegramUsername.replace('@', '')}`
          : undefined);

      if (!chatId) {
        throw new BadRequestException('Invalid telegram chat id');
      }

      const tgCheck = await this.telegramService.checkBotAdmin(chatId);

      if (!tgCheck.exists) {
        throw new BadRequestException(
          'Bot is not a member of this channel/group',
        );
      }

      if (!tgCheck.isAdmin) {
        throw new BadRequestException(
          'Bot must be administrator in the channel/group',
        );
      }
      console.log(tgCheck);

      const channel = await this.writeRepo.create({
        telegramId: tgCheck.chat?.id,
        telegramUsername: tgCheck.chat?.username,
        name: tgCheck.chat?.title ?? data.name,
        type: data.type ?? ChannelType.OTHER,
        isActive: true,
      });

      return channel;
    } catch (error) {
      this.logger.error(
        {
          err: error,
          data,
        },
        'Create channel failed',
      );

      throw error;
    }
  }

  async getAllChannels(query: {
    type?: ChannelType;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<Paginated<Channel>> {
    this.logger.debug({
      query,
      msg: 'Get all channels request',
    });

    const { page, limit, skip, take } = getPaginationParams(
      query.page,
      query.limit,
    );

    const filters = {
      type: query.type,
      isActive: query.isActive,
    };

    const [items, total] = await this.readRepo.findMany(filters, {
      skip,
      take,
    });

    return buildPaginatedResponse({
      items,
      total,
      page,
      limit,
    });
  }

  async getChannelsByIds(ids: number[]): Promise<Channel[]> {
    this.logger.debug({ ids }, 'Get channels by ids request');

    return this.readRepo.findManyByIds(ids);
  }

  async getActiveChannels(): Promise<Channel[]> {
    this.logger.debug('Get active channels request');

    return this.readRepo.findActive();
  }

  async getChannelById(id: number): Promise<Channel> {
    this.logger.debug({ id }, 'Get channel by id');

    const channel = await this.readRepo.findById(id);

    if (!channel) {
      this.logger.warn({ id }, 'Channel not found');

      throw new NotFoundException(`Channel with id=${id} not found`);
    }

    return channel;
  }

  async getChannelsByParameters(
    params: FindOptionsWhere<Channel>,
  ): Promise<Channel[]> {
    this.logger.debug({ params }, 'Get channels by parameters request');

    const a = await this.readRepo.findManyByParams(params);
    return a;
  }

  async updateChannel(
    id: number,
    data: {
      name?: string;
      telegramUsername?: string;
      isActive?: boolean;
      type?: ChannelType;
    },
  ): Promise<Channel> {
    this.logger.log({ id, data }, 'Update channel started');

    const updated = await this.writeRepo.update(id, data);

    this.logger.log(
      { id, updatedFields: Object.keys(data) },
      'Channel successfully updated',
    );

    return updated;
  }

  async setChannelActive(id: number, isActive: boolean): Promise<void> {
    this.logger.log({ id, isActive }, 'Set channel active state');

    return this.writeRepo.setActive(id, isActive);
  }

  async deleteChannelById(id: number): Promise<void> {
    try {
      this.logger.log({ id }, 'Delete channel request');

      await this.writeRepo.delete(id);

      this.logger.log({ id }, 'Channel deleted');
    } catch (error) {
      this.logger.log(
        {
          id,
          err: error,
        },
        'Delete channel failed',
      );
      throw error;
    }
  }

  async deleteChannelByTelegramId(telegramId: number): Promise<void> {
    this.logger.log({ telegramId }, 'Delete channel by telegramId started');

    await this.writeRepo.deleteByTelegramId(telegramId);

    this.logger.log(
      { telegramId },
      'Channel successfully deleted by telegramId',
    );
  }
}
