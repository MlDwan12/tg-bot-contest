import './env'; // .env.test + защита
import { DataSource } from 'typeorm';
import { initTestDb, truncateAll, closeTestDb, testRedis } from './harness';

/**
 * Проверяем сам харнесс (Фаза 0.1c): очистку состояния между тестами и Redis.
 * Это «тест на инструмент», а не на бизнес-логику.
 */
describe('харнесс: чистое состояние между тестами', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await initTestDb();
  });

  afterAll(async () => {
    await closeTestDb(ds);
  });

  // Перед КАЖДЫМ тестом — очищаем базу. Это и есть проверяемое поведение.
  beforeEach(async () => {
    await truncateAll(ds);
  });

  it('строка, вставленная в тесте, видна внутри этого теста', async () => {
    await ds.query(
      `INSERT INTO channels (name, "isActive", type) VALUES ('t', true, 'other')`,
    );
    const r = await ds.query<{ c: number }[]>(
      `SELECT count(*)::int AS c FROM channels`,
    );
    expect(r[0].c).toBe(1);
  });

  it('в следующем тесте база снова пуста — beforeEach отработал', async () => {
    const r = await ds.query<{ c: number }[]>(
      `SELECT count(*)::int AS c FROM channels`,
    );
    expect(r[0].c).toBe(0);
  });
});

describe('харнесс: тестовый Redis', () => {
  it('отвечает на ping', async () => {
    const redis = testRedis();
    const pong = await redis.ping();
    expect(pong).toBe('PONG');
    await redis.quit();
  });
});
