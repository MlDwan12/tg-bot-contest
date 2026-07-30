import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { ChannelPlatform } from 'src/common/enums/channel';
import { Channel } from '../entities';
import { TelegramService } from 'src/modules/bot/bot.service';

@Injectable()
export class ChannelHealthService {
  constructor(
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    private readonly telegramService: TelegramService,
    private readonly logger: Logger,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkChannelsHealth(): Promise<void> {
    this.logger.log('checkChannelsHealth: start');

    const channels = await this.channelRepository.find();

    if (!channels.length) {
      this.logger.log('checkChannelsHealth: нет каналов для проверки');
      return;
    }

    for (const channel of channels) {
      if (channel.platform !== ChannelPlatform.TELEGRAM) {
        this.logger.debug(
          { channelId: channel.id, platform: channel.platform },
          'checkChannelsHealth: платформа пока не поддерживается проверкой, пропущен',
        );
        continue;
      }

      if (!channel.externalId) {
        this.logger.warn(
          { channelId: channel.id },
          'checkChannelsHealth: канал без externalId, пропущен',
        );
        continue;
      }

      try {
        const check = await this.telegramService.checkBotChannelPermissions(
          Number(channel.externalId),
        );

        const isValid =
          check.exists && check.isAdmin && check.canPost && check.canEdit;

        if (channel.isActive !== isValid) {
          await this.channelRepository.update(channel.id, {
            isActive: isValid,
          });

          this.logger.warn(
            {
              channelId: channel.id,
              externalId: channel.externalId,
              isActive: isValid,
            },
            'checkChannelsHealth: статус канала обновлён',
          );
        } else {
          this.logger.debug(
            {
              channelId: channel.id,
              externalId: channel.externalId,
              isActive: isValid,
            },
            'checkChannelsHealth: статус без изменений',
          );
        }
      } catch (error: any) {
        this.logger.error(
          { err: error, channelId: channel.id, externalId: channel.externalId },
          'checkChannelsHealth: ошибка проверки канала',
        );

        if (channel.isActive !== false) {
          await this.channelRepository.update(channel.id, {
            isActive: false,
          });

          this.logger.warn(
            { channelId: channel.id, externalId: channel.externalId },
            'checkChannelsHealth: канал помечен неактивным из-за ошибки',
          );
        }
      }
    }

    this.logger.log('checkChannelsHealth: done');
  }
}
