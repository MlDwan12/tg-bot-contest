import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { Channel } from '../entities';
import { TelegramService } from 'src/modules/bot/bot.service';
import { getAdminTelegramIdsFromEnv } from 'src/common/helpers/admin-ids.helper';

type PermissionsCheck = Awaited<
  ReturnType<TelegramService['checkBotChannelPermissions']>
>;

@Injectable()
export class ChannelHealthService {
  constructor(
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    private readonly telegramService: TelegramService,
    private readonly logger: Logger,
  ) {}

  // Раз в час: сверяет права бота и название/username канала с Telegram,
  // обновляет БД и шлёт админам (ADMIN_IDS) одну сводку по изменениям.
  @Cron(CronExpression.EVERY_HOUR)
  async checkChannelsHealth(): Promise<void> {
    this.logger.log('checkChannelsHealth: start');

    const channels = await this.channelRepository.find();
    const report: string[] = [];

    for (const channel of channels) {
      if (!channel.telegramId) {
        this.logger.warn(
          { channelId: channel.id },
          'checkChannelsHealth: канал без telegramId, пропущен',
        );
        continue;
      }

      let check: PermissionsCheck | undefined;
      try {
        check = await this.telegramService.checkBotChannelPermissions(
          Number(channel.telegramId),
        );
      } catch (error) {
        this.logger.error(
          { err: error, channelId: channel.id, telegramId: channel.telegramId },
          'checkChannelsHealth: ошибка проверки канала',
        );
      }

      try {
        const lines = await this.syncChannel(channel, check);
        if (lines.length) {
          report.push(
            `📢 ${channel.name ?? channel.telegramId} (ID: ${channel.id})\n` +
              lines.map((l) => `• ${l}`).join('\n'),
          );
        }
      } catch (error) {
        // Ошибка БД (например, уникальность telegramUsername) — не повод
        // считать канал сломанным, просто сообщаем.
        this.logger.error(
          { err: error, channelId: channel.id },
          'checkChannelsHealth: не удалось обновить канал',
        );
        report.push(
          `📢 ${channel.name ?? channel.telegramId} (ID: ${channel.id})\n` +
            `• ❗ не удалось сохранить изменения: ${(error as Error).message}`,
        );
      }
    }

    if (report.length) {
      await this.notifyAdmins(
        `🔎 Изменения в каналах:\n\n${report.join('\n\n')}`,
      );
    }

    this.logger.log({ changed: report.length }, 'checkChannelsHealth: done');
  }

  // check === undefined — Telegram ответил неожиданной ошибкой.
  private async syncChannel(
    channel: Channel,
    check: PermissionsCheck | undefined,
  ): Promise<string[]> {
    const lines: string[] = [];
    const patch: Partial<Channel> = {};

    const isValid =
      !!check &&
      check.exists &&
      check.isAdmin &&
      check.canPost &&
      check.canEdit;

    if (channel.isActive !== isValid) {
      patch.isActive = isValid;
      lines.push(isValid ? '✅ канал снова доступен боту' : problemText(check));
    }

    if (check?.chat) {
      const title = check.chat.title?.slice(0, 100);
      if (title && title !== channel.name) {
        patch.name = title;
        lines.push(`название: «${channel.name ?? '—'}» → «${title}»`);
      }

      const username = check.chat.username ?? null;
      if (username !== (channel.telegramUsername ?? null)) {
        patch.telegramUsername = username as string | undefined;
        lines.push(
          `username: @${channel.telegramUsername ?? '—'} → @${username ?? '— (канал стал приватным)'}`,
        );

        // Приватному каналу нужна invite-ссылка, публичный обходится t.me/{username}.
        if (!username && !channel.inviteLink) {
          const link = await this.telegramService.createChannelInviteLink(
            check.chat.id,
          );
          if (link) patch.inviteLink = link;
          else lines.push('❗ не удалось создать invite-ссылку');
        }
      }
    }

    if (Object.keys(patch).length) {
      await this.channelRepository.update(channel.id, patch);
      this.logger.warn(
        { channelId: channel.id, telegramId: channel.telegramId, patch },
        'checkChannelsHealth: канал обновлён',
      );
    }

    return lines;
  }

  private async notifyAdmins(text: string): Promise<void> {
    const admins = getAdminTelegramIdsFromEnv();
    if (!admins.length) {
      this.logger.warn('checkChannelsHealth: нет ADMIN_IDS для уведомления');
      return;
    }

    for (const admin of admins) {
      try {
        // sendMailingMessage шлёт с parse_mode HTML, а в названиях бывают < & >.
        await this.telegramService.sendMailingMessage({
          chatId: admin,
          text: text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;'),
        });
      } catch (error) {
        this.logger.error(
          { err: error, adminTelegramId: admin },
          'checkChannelsHealth: не удалось отправить уведомление',
        );
      }
    }
  }
}

function problemText(check: PermissionsCheck | undefined): string {
  if (!check) return '⚠️ ошибка проверки, канал отключён';
  if (!check.exists) return '⛔ бот удалён из канала или канал недоступен';
  if (!check.isAdmin) return '⛔ бот больше не администратор';
  const missing = [
    !check.canPost && 'публикация',
    !check.canEdit && 'редактирование',
  ].filter(Boolean);
  return `⛔ у бота отобраны права: ${missing.join(', ')}`;
}
