import * as dotenv from 'dotenv';
import * as path from 'path';
import { DataSource } from 'typeorm';

// Грузим тестовый конфиг (.env.test), а не dev.
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

// ЗАЩИТА: миграции/тесты только по тестовой базе (имя обязано содержать "test").
if (!process.env.DATABASE_NAME || !/test/i.test(process.env.DATABASE_NAME)) {
  throw new Error(
    `[test-data-source] DATABASE_NAME="${process.env.DATABASE_NAME}" ` +
      `не тестовая база. Проверь .env.test.`,
  );
}

/**
 * DataSource для интеграционных тестов.
 * Отличие от боевого src/database/data-source.ts: смотрит на ИСХОДНИКИ (.ts),
 * т.к. тесты гоняются через ts-node/ts-jest без сборки в dist.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  schema: process.env.DATABASE_SCHEMA || 'public',

  synchronize: false, // схему создают ТОЛЬКО миграции — как в проде
  logging: false,

  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  migrationsTableName: 'migrations',
});
