import './env'; // .env.test + защита
import { Client } from 'pg';

/**
 * Проверка, что миграции реально применились к тест-базе (Фаза 0.1b).
 * to_regclass возвращает имя таблицы, если она есть, иначе null.
 */
describe('схема: миграции применены к тест-базе', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT),
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
    });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  it.each(['contests', 'contest_participants', 'users', 'channels'])(
    'таблица "%s" существует',
    async (table) => {
      const res = await client.query<{ t: string | null }>(
        `SELECT to_regclass($1) AS t`,
        [`public.${table}`],
      );
      expect(res.rows[0].t).toBe(table);
    },
  );
});
