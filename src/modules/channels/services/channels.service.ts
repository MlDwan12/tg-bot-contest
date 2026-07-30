import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CHANNEL_REPOSITORY } from 'src/common/constants';

import { ChannelPlatform, ChannelType } from 'src/common/enums/channel';
import { Channel } from '../entities';
import type { IChannelRepository } from '../interfaces';
import { TelegramService } from 'src/modules/bot/bot.service';
import { Logger } from 'nestjs-pino';
import { Paginated } from 'src/common/response/paginated.type';
import { buildPaginatedResponse } from 'src/common/helpers/paginatedResponse.helper';
import { getPaginationParams } from 'src/common/helpers/paginationParams.helper';
import { FindOptionsWhere } from 'typeorm';

@Injectable()
export class ChannelsService {
  constructor(
    @Inject(CHANNEL_REPOSITORY)
    private readonly channelRepo: IChannelRepository,

    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    private readonly logger: Logger,
  ) {}

  /**
   * Переходный период: админ-панель пока шлёт telegramId/telegramUsername
   * без явного platform. Нормализуем legacy-вход в один канонический вид,
   * дальше по коду platform/externalId используются как единственный источник истины.
   */
  private resolveExternalIdentity(data: {
    telegramId?: number;
    telegramUsername?: string;
    platform?: ChannelPlatform;
    externalId?: string;
    externalUsername?: string;
  }): {
    platform: ChannelPlatform;
    externalId?: string;
    externalUsername?: string;
  } {
    if (data.platform) {
      return {
        platform: data.platform,
        externalId: data.externalId,
        externalUsername: data.externalUsername,
      };
    }

    return {
      platform: ChannelPlatform.TELEGRAM,
      externalId:
        data.externalId ??
        (data.telegramId !== undefined ? String(data.telegramId) : undefined),
      externalUsername: data.externalUsername ?? data.telegramUsername,
    };
  }

  async createChannel(data: {
    telegramId?: number;
    telegramUsername?: string;
    platform?: ChannelPlatform;
    externalId?: string;
    externalUsername?: string;
    name?: string;
    type?: ChannelType;
  }): Promise<Channel> {
    try {
      this.logger.debug({ data }, 'createChannel: start');

      const identity = this.resolveExternalIdentity(data);

      if (!identity.externalId && !identity.externalUsername) {
        throw new BadRequestException(
          'externalId or externalUsername is required',
        );
      }

      if (identity.platform !== ChannelPlatform.TELEGRAM) {
        throw new BadRequestException(
          `Платформа ${String(identity.platform)} пока не поддерживается`,
        );
      }

      if (identity.externalId) {
        const exists = await this.channelRepo.findByExternalId(
          identity.platform,
          identity.externalId,
        );

        if (exists) {
          throw new BadRequestException(
            'Channel with this externalId already exists',
          );
        }
      }

      const chatId: number | string | undefined =
        identity.externalId !== undefined
          ? Number(identity.externalId)
          : identity.externalUsername
            ? `@${identity.externalUsername.replace('@', '')}`
            : undefined;

      if (!chatId) {
        throw new BadRequestException('Invalid telegram chat id');
      }

      // checkBotAdmin принимает и username вида "@chat" через Telegraf, хотя
      // его сигнатура сужена до number — то же самое допущение было и в коде
      // до миграции на externalId.
      const tgCheck = await this.telegramService.checkBotAdmin(
        chatId as number,
      );

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
      const channel = await this.channelRepo.create({
        platform: ChannelPlatform.TELEGRAM,
        externalId:
          tgCheck.chat?.id !== undefined ? String(tgCheck.chat.id) : undefined,
        externalUsername: tgCheck.chat?.username,
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

    const [items, total] = await this.channelRepo.findMany(filters, {
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

    return this.channelRepo.findManyByIds(ids);
  }

  async getActiveChannels(): Promise<Channel[]> {
    this.logger.debug('Get active channels request');

    return this.channelRepo.findActive();
  }

  async getChannelById(id: number): Promise<Channel> {
    this.logger.debug({ id }, 'Get channel by id');

    const channel = await this.channelRepo.findById(id);

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

    const a = await this.channelRepo.findManyByParams(params);
    return a;
  }

  async updateChannel(
    id: number,
    data: {
      name?: string;
      externalUsername?: string;
      isActive?: boolean;
      type?: ChannelType;
    },
  ): Promise<Channel> {
    this.logger.debug({ id, data }, 'updateChannel: start');

    const updated = await this.channelRepo.update(id, data);

    this.logger.log(
      { id, updatedFields: Object.keys(data) },
      'updateChannel: done',
    );

    return updated;
  }

  async setChannelActive(id: number, isActive: boolean): Promise<void> {
    this.logger.log({ id, isActive }, 'setChannelActive');

    return this.channelRepo.setActive(id, isActive);
  }

  async deleteChannelById(id: number): Promise<void> {
    try {
      await this.channelRepo.delete(id);
      this.logger.log({ id }, 'deleteChannelById: done');
    } catch (error) {
      this.logger.error({ id, err: error }, 'deleteChannelById: failed');
      throw error;
    }
  }

  async deleteChannelByExternalId(
    platform: ChannelPlatform,
    externalId: string,
  ): Promise<void> {
    await this.channelRepo.deleteByExternalId(platform, externalId);
    this.logger.log(
      { platform, externalId },
      'deleteChannelByExternalId: done',
    );
  }
}
