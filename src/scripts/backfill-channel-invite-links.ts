import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { Telegraf } from 'telegraf';
import { Channel } from '../modules/channels/entities/channel.entity';

dotenv.config({
  path:
    process.env.NODE_ENV === 'production'
      ? '.env.production'
      : '.env.development',
});

/**
 * Разовый бэкфилл invite-ссылок для приватных каналов (без telegramUsername).
 * НЕ поднимает Nest/TelegrafModule (bot.launch()) — только прямой доступ к БД
 * через TypeORM DataSource и к Telegram Bot API через bot.telegram, без
 * запуска long-polling. Второй bot.launch() с тем же токеном конфликтует с
 * боевым инстансом (Telegram отвечает 409 Conflict обоим), из-за чего в
 * проде 2026-08-19 перезапускался основной контейнер — раньше скрипт поднимал
 * весь AppModule, включая TelegrafModule.
 *
 * Запуск (dev): yarn ts-node -r tsconfig-paths/register src/scripts/backfill-channel-invite-links.ts
 * Запуск (prod, из готового образа): node dist/scripts/backfill-channel-invite-links.js
 */
async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');

  const bot = new Telegraf(token);

  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT) || 5432,
    username: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'password',
    database: process.env.DATABASE_NAME || 'contestdb',
    schema: process.env.DATABASE_SCHEMA || 'public',
    entities: [Channel],
  });

  await dataSource.initialize();
  const channelRepo = dataSource.getRepository(Channel);

  const channels = await channelRepo.find();
  const targets = channels.filter((c) => !c.telegramUsername && !c.inviteLink);

  console.log(
    JSON.stringify({
      msg: 'backfill-channel-invite-links: start',
      total: channels.length,
      targets: targets.length,
    }),
  );

  let done = 0;
  let failed = 0;

  for (const channel of targets) {
    if (channel.telegramId == null) {
      console.warn(`Пропущен channelId=${channel.id}: нет telegramId`);
      continue;
    }

    try {
      const link = await bot.telegram.createChatInviteLink(channel.telegramId);
      await channelRepo.update(channel.id, { inviteLink: link.invite_link });
      done++;
      console.log(`channelId=${channel.id}: invite-link сохранён`);
    } catch (error: any) {
      failed++;
      console.warn(
        `channelId=${channel.id} telegramId=${channel.telegramId}: не удалось создать invite-link`,
        error?.response ?? error?.message ?? error,
      );
    }
  }

  console.log(
    JSON.stringify({
      msg: 'backfill-channel-invite-links: finished',
      done,
      failed,
    }),
  );

  await dataSource.destroy();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('backfill-channel-invite-links failed:', error);
    process.exit(1);
  });
