import './env'; // загрузка .env.test + защита должны идти ПЕРВОЙ строкой

// NODE_ENV=test выставляем ДО загрузки AppModule: ConfigModule.forRoot
// (в AppConfigModule) читает NODE_ENV в момент импорта, чтобы выбрать .env.test.
// Поэтому AppModule подгружается ДИНАМИЧЕСКИ внутри теста, уже после этой строки.
process.env.NODE_ENV = 'test';

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

/**
 * Bootstrap-smoke (сеть безопасности под Фазу 6 — разрыв циклов).
 *
 * Бизнес-правило (инвариант): приложение обязано СОБИРАТЬСЯ — Nest должен
 * зарезолвить весь DI-граф, все forwardRef-циклы между модулями (bot↔contests,
 * bot↔channels, contests↔contests-jobs, users↔auth) валидны, singleton-провайдеры
 * инстанцируются. Сейчас инвариант держится ТОЛЬКО за счёт правильно расставленных
 * forwardRef.
 *
 * 🟢 Роль: это НЕ мишень-баг, а сторож. Он подтверждает, что контейнер собирается
 * сейчас (с циклами). В Фазе 6 при разрыве цикла он обязан ОСТАТЬСЯ зелёным; если
 * разрыв неправильно перевяжет DI — .compile() бросит «circular dependency / cannot
 * resolve», и тест покраснеет. Это ровно тот класс поломок, который наши остальные
 * инт-тесты не ловят: они собирают сервисы вручную (build-services.ts), ОБХОДЯ Nest DI.
 *
 * Почему только .compile() (без .init()): compile строит инъектор и инстанцирует
 * провайдеры — тут и всплывают битые циклы. .init() дополнительно запустил бы бота
 * (Telegraf → сеть), воркеры очередей и шедулеры — лишние сайд-эффекты для проверки
 * СБОРКИ. Подключение к тест-Postgres/Redis при compile — штатно (стек поднят
 * `yarn test:db:up`, как для прочих инт-тестов).
 */
describe('bootstrap-smoke: DI-граф AppModule собирается (сеть под Фазу 6)', () => {
  let moduleRef: TestingModule;

  afterAll(async () => {
    // Best-effort закрытие: moduleRef.close() зовёт shutdown-хуки, и nestjs-telegraf
    // на compile-only бросает «Bot is not running!» (бота не запускали). Это безобидно —
    // глотаем, чтобы не рушить сьют. Остаточные хендлы тяжёлой инфры (BullMQ/Telegraf)
    // добивает forceExit в jest-integration.json.
    if (moduleRef) {
      try {
        await moduleRef.close();
      } catch {
        // ожидаемо на compile-only (Telegraf stop без launch)
      }
    }
  });

  it('AppModule.compile() резолвит все forwardRef-циклы и инстанцирует провайдеры', async () => {
    // require (не import()) — ts-jest компилит в CommonJS, где настоящий
    // динамический import() падает без --experimental-vm-modules. require
    // выполняется В МОМЕНТ ВЫЗОВА (после NODE_ENV='test' выше) — то, что нужно.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('src/app.module') as typeof import('src/app.module');

    // Если хоть один forwardRef-цикл перевязан неверно — здесь будет throw.
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    // ConfigService доступен → окружение провалидировано, контейнер сконфигурирован.
    expect(moduleRef.get(ConfigService)).toBeDefined();

    // Провайдер из ЯДРА цикла bot↔contests реально инстанцирован (а не лениво пропущен).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TelegramService } = require('src/modules/bot/bot.service') as typeof import('src/modules/bot/bot.service');
    const telegram = moduleRef.get(TelegramService, { strict: false });

    console.log(
      `[наблюдение] AppModule собран: ConfigService=ok; TelegramService (ядро цикла bot↔contests)=${
        telegram instanceof TelegramService ? 'инстанцирован' : 'НЕТ'
      }`,
    );

    expect(telegram).toBeInstanceOf(TelegramService);
  });
});
