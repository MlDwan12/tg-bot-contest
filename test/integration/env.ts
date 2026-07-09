import * as dotenv from 'dotenv';
import * as path from 'path';

// Загружаем ИМЕННО тестовый конфиг (.env.test), а не .env.development.
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

// ЗАЩИТА ОТ ДУРАКА: интеграционные тесты чистят таблицы (TRUNCATE),
// поэтому они ОБЯЗАНЫ работать только с тестовой базой.
// Если имя базы не содержит "test" — падаем сразу, до любого запроса,
// чтобы случайно не снести рабочие данные.
if (!process.env.DATABASE_NAME || !/test/i.test(process.env.DATABASE_NAME)) {
  throw new Error(
    `[тест-харнесс] Отказ: DATABASE_NAME="${process.env.DATABASE_NAME}" ` +
      `не похоже на тестовую базу (должно содержать "test"). Проверь .env.test.`,
  );
}
