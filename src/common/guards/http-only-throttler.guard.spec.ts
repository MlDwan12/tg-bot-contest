import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler';
import { HttpOnlyThrottlerGuard } from './http-only-throttler.guard';

/**
 * Юнит (guard собирается вручную, вне Nest DI).
 *
 * Правило (🟢): ограничитель частоты — HTTP-механика. Веб-запросы он считает,
 * всё остальное (листенеры Telegraf) пропускает не глядя.
 *
 * Мишень (🔴): прод-баг — глобальный APP_GUARD накрывал и Telegraf-листенеры,
 * ронял их на res.header() и глушил все команды бота.
 */

// Зеркалит ThrottlerModule.forRoot() из config.module.ts.
const options = { throttlers: [{ name: 'global', ttl: 60, limit: 100 }] };

function makeStorage(): ThrottlerStorage & { increment: jest.Mock } {
  return {
    increment: jest.fn().mockResolvedValue({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    }),
  } as unknown as ThrottlerStorage & { increment: jest.Mock };
}

/**
 * Контекст листенера Telegraf. Ключевое — switchToHttp() отдаёт объекты БЕЗ
 * header(): в проде там не Express, а обёртка над апдейтом Telegram. Если
 * guard всё-таки полезет за заголовками, тест упадёт так же, как прод.
 */
function mockTelegrafContext(): ExecutionContext {
  class BotUpdate {}
  return {
    getType: () => 'telegraf',
    getHandler: () => function start() {},
    getClass: () => BotUpdate,
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

function mockHttpContext(): {
  context: ExecutionContext;
  header: jest.Mock;
} {
  const header = jest.fn();
  const res = { header };
  const req = { ip: '1.2.3.4', headers: {} };
  class ContestController {}

  const context = {
    getType: () => 'http',
    getHandler: () => function participate() {},
    getClass: () => ContestController,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;

  return { context, header };
}

async function buildGuard<T extends ThrottlerGuard>(
  Ctor: new (...args: any[]) => T,
  storage: ThrottlerStorage,
): Promise<T> {
  const guard = new Ctor(options, storage, new Reflector());
  // Заполняет this.throttlers/commonOptions — в проде это делает Nest.
  await guard.onModuleInit();
  return guard;
}

describe('HttpOnlyThrottlerGuard (троттлинг только для HTTP)', () => {
  it('🔴 мишень: контекст Telegraf → пропускает, не падает, лимит не считает', async () => {
    const storage = makeStorage();
    const guard = await buildGuard(HttpOnlyThrottlerGuard, storage);

    const allowed = await guard.canActivate(mockTelegrafContext());

    console.log('[наблюдение] telegraf-контекст: allowed =', allowed);
    expect(allowed).toBe(true);
    // Не просто «не упал» — вообще не трогал счётчик: команды бота
    // не должны съедать лимит веб-запросов.
    expect(storage.increment).not.toHaveBeenCalled();
  });

  it('🟢 HTTP-запрос → лимит считается, заголовки ставятся', async () => {
    const storage = makeStorage();
    const guard = await buildGuard(HttpOnlyThrottlerGuard, storage);
    const { context, header } = mockHttpContext();

    const allowed = await guard.canActivate(context);

    const headerNames = header.mock.calls.map((c) => c[0]);
    console.log(
      '[наблюдение] http-контекст: allowed =',
      allowed,
      '| increment вызван =',
      storage.increment.mock.calls.length,
      '| заголовки =',
      headerNames,
    );
    expect(allowed).toBe(true);
    expect(storage.increment).toHaveBeenCalledTimes(1);
    expect(headerNames).toContain('X-RateLimit-Limit-global');
  });

  it('диагноз: базовый ThrottlerGuard на том же контексте падает (ради этого и подкласс)', async () => {
    const guard = await buildGuard(ThrottlerGuard, makeStorage());

    await expect(guard.canActivate(mockTelegrafContext())).rejects.toThrow(
      'res.header is not a function',
    );
  });
});
