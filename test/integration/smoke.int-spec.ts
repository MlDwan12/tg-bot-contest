import './env'; // загрузка .env.test + защита должны идти ПЕРВОЙ строкой
import { Client } from 'pg';

/**
 * Дымовой тест харнесса (Фаза 0.1a).
 * Цель: доказать, что тесты видят твой локальный Postgres и ходят в ОТДЕЛЬНУЮ
 * тестовую базу tg_bot_test. Пока без миграций и Nest — только «подключиться и спросить».
 */
describe('smoke: локальный Postgres (тестовая база tg_bot_test)', () => {
  it('подключается к тестовой базе и выполняет запрос', async () => {
    const client = new Client({
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT),
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
    });

    await client.connect();

    // Проверяем и связь, и что мы реально в базе с именем *_test.
    const res = await client.query<{ ok: number; db: string }>(
      'SELECT 1 AS ok, current_database() AS db',
    );
    expect(res.rows[0].ok).toBe(1);
    expect(res.rows[0].db).toMatch(/test/i);

    await client.end();
  });
});
