import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger } from '@nestjs/common';
import { Channel } from '../entities';
import { TelegramService } from 'src/modules/bot/bot.service';

@Injectable()
export class ChannelHealthService {
  private readonly logger = new Logger(ChannelHealthService.name);

  constructor(
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    private readonly telegramService: TelegramService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkChannelsHealth(): Promise<void> {
    this.logger.log('Запущена ежедневная проверка прав бота во всех каналах');

    const channels = await this.channelRepository.find();

    if (!channels.length) {
      this.logger.log('Каналы для проверки не найдены');
      return;
    }

    for (const channel of channels) {
      if (!channel.telegramId) {
        this.logger.warn(
          `Канал id=${channel.id} пропущен: отсутствует telegramId`,
        );
        continue;
      }

      try {
        const check = await this.telegramService.checkBotChannelPermissions(
          Number(channel.telegramId),
        );

        const isValid =
          check.exists && check.isAdmin && check.canPost && check.canEdit;

        if (channel.isActive !== isValid) {
          await this.channelRepository.update(channel.id, {
            isActive: isValid,
          });

          this.logger.warn(
            `Обновлен статус канала id=${channel.id}, telegramId=${channel.telegramId}: isActive=${isValid}`,
          );
        } else {
          this.logger.log(
            `Канал id=${channel.id}, telegramId=${channel.telegramId}: статус без изменений (${isValid})`,
          );
        }
      } catch (error: any) {
        this.logger.error(
          `Ошибка проверки канала id=${channel.id}, telegramId=${channel.telegramId}: ${error.message}`,
          error.stack,
        );

        if (channel.isActive !== false) {
          await this.channelRepository.update(channel.id, {
            isActive: false,
          });

          this.logger.warn(
            `Канал id=${channel.id}, telegramId=${channel.telegramId} помечен как неактивный из-за ошибки проверки`,
          );
        }
      }
    }

    this.logger.log('Ежедневная проверка каналов завершена');
  }
}
