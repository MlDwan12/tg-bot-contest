import { ArgumentsHost, BadRequestException } from '@nestjs/common';

// Полный мок Sentry — надёжнее, чем spyOn (в v10 экспорты бывают
// неперезаписываемыми). Фильтр импортирует именно этот модуль.
jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/node';
import { AllExceptionsFilter } from './allExceptionsFilter';

const captureMock = Sentry.captureException as unknown as jest.Mock;

/**
 * Юнит (bootstrap-уровень, вне интеграционного HTTP-харнесса).
 * Правило (🟢): 5xx и необработанные не-HTTP исключения уходят в Sentry;
 * клиентские 4xx — НЕ уходят (иначе Sentry захлебнётся ожидаемым шумом).
 */
function mockHost(
  type: 'http' | 'rpc',
  opts: { method?: string; url?: string } = {},
): { host: ArgumentsHost; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = { method: opts.method ?? 'GET', url: opts.url ?? '/x' };

  const host = {
    getType: () => type,
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('AllExceptionsFilter → Sentry (5xx да, 4xx нет)', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    captureMock.mockClear();
    filter = new AllExceptionsFilter();
    // Глушим шум логера в тесте.
    jest
      .spyOn(
        (filter as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('5xx (неизвестная ошибка) → уходит в Sentry + конверт 500', () => {
    const { host, status, json } = mockHost('http');

    filter.catch(new Error('boom'), host);

    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, status: 500 }),
    );
  });

  it('4xx (BadRequest) → в Sentry НЕ уходит', () => {
    const { host, status } = mockHost('http');

    filter.catch(new BadRequestException('bad'), host);

    expect(captureMock).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
  });

  it('необработанное вне HTTP → уходит в Sentry', () => {
    const { host } = mockHost('rpc');

    filter.catch(new Error('bg fail'), host);

    expect(captureMock).toHaveBeenCalledTimes(1);
  });
});
