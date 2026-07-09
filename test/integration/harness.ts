// Импорт test-data-source заодно грузит .env.test (внутри него dotenv) и проверку защиты.
import testDataSource from './test-data-source';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';

/**
 * Инициализирует (один раз) подключение к тестовой БД и возвращает DataSource.
 * DataSource — это «пул соединений» TypeORM к нашей tg_bot_test.
 */
export async function initTestDb(): Promise<DataSource> {
  if (!testDataSource.isInitialized) {
    await testDataSource.initialize();
  }
  return testDataSource;
}

/**
 * Чистит ВСЕ таблицы public, кроме служебной `migrations`.
 * RESTART IDENTITY — сбрасывает счётчики id (чтобы id снова начинались с 1).
 * CASCADE — заодно чистит связанные по внешним ключам строки.
 * Вызывается в beforeEach, чтобы каждый тест стартовал с пустой базы.
 */
export async function truncateAll(ds: DataSource): Promise<void> {
  const rows: Array<{ tablename: string }> = await ds.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'`,
  );
  if (rows.length === 0) return;

  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await ds.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

/** Закрывает подключение к тест-БД (в afterAll). */
export async function closeTestDb(ds: DataSource): Promise<void> {
  if (ds.isInitialized) {
    await ds.destroy();
  }
}

/**
 * Клиент к ТЕСТОВОМУ Redis (стек на 6380, отдельный индекс из .env.test).
 * Не трогает твой рабочий Redis.
 */
export function testRedis(): Redis {
  return new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    db: Number(process.env.REDIS_DB ?? 0),
    maxRetriesPerRequest: null,
  });
}
