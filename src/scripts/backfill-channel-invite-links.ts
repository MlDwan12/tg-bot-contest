import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../app.module';
import { ChannelsService } from '../modules/channels/services';
import { TelegramService } from '../modules/bot/bot.service';

/**
 * Разовый бэкфилл: приватным каналам (без telegramUsername), у которых ещё
 * нет inviteLink, создаёт и сохраняет invite-ссылку через Telegram Bot API.
 * Публичные каналы не трогает — им ссылка не нужна, строится как t.me/{username}.
 *
 * Запуск: yarn ts-node -r tsconfig-paths/register src/scripts/backfill-channel-invite-links.ts
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });

  const logger = app.get(Logger);
  const channelsService = app.get(ChannelsService);
  const telegramService = app.get(TelegramService);

  const channels = await channelsService.getChannelsByParameters({});
  const targets = channels.filter((c) => !c.telegramUsername && !c.inviteLink);

  logger.log(
    { total: channels.length, targets: targets.length },
    'backfill-channel-invite-links: start',
  );

  let done = 0;
  let failed = 0;

  for (const channel of targets) {
    if (channel.telegramId == null) {
      logger.warn({ channelId: channel.id }, 'Пропущен: нет telegramId');
      continue;
    }

    const link = await telegramService.createChannelInviteLink(
      channel.telegramId,
    );

    if (!link) {
      failed++;
      logger.warn(
        { channelId: channel.id, telegramId: channel.telegramId },
        'Не удалось создать invite-link (бот не админ / канал недоступен)',
      );
      continue;
    }

    await channelsService.updateChannel(channel.id, { inviteLink: link });
    done++;
    logger.log({ channelId: channel.id }, 'invite-link сохранён');
  }

  logger.log({ done, failed }, 'backfill-channel-invite-links: finished');

  try {
    await app.close();
  } catch {
    // nestjs-telegraf на shutdown пытается остановить bot-поллинг; в
    // одноразовом скрипте оно может не успеть подняться за время работы
    // скрипта — это не ошибка backfill'а, просто игнорируем.
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('backfill-channel-invite-links failed:', error);
  process.exit(1);
});
