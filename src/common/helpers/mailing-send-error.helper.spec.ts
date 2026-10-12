import { classifyMailingSendError } from './mailing-send-error.helper';

// Ошибка в форме telegraf TelegramError: message "<code>: <description>".
function telegramError(code: number, description: string) {
  return Object.assign(new Error(`${code}: ${description}`), {
    name: 'TelegramError',
    response: { ok: false, error_code: code, description },
  });
}

function networkError(name: string) {
  return Object.assign(new Error('request failed'), { name });
}

describe('classifyMailingSendError', () => {
  it.each([
    [telegramError(403, 'Forbidden: bot was blocked by the user'), 'blocked'],
    [telegramError(403, 'Forbidden: user is deactivated'), 'blocked'],
    [telegramError(429, 'Too Many Requests: retry after 5'), 'temporary'],
    [telegramError(500, 'Internal Server Error'), 'temporary'],
    [telegramError(502, 'Bad Gateway'), 'temporary'],
    [networkError('FetchError'), 'temporary'],
    [networkError('AbortError'), 'temporary'],
    [telegramError(400, 'Bad Request: chat not found'), 'error'],
    [telegramError(403, "Forbidden: bot can't initiate conversation with a user"), 'error'],
    [new Error('Media file not found: uploads/x.png'), 'error'],
    [new Error('Unsupported media type: .bmp'), 'error'],
    ['какая-то строка', 'error'],
  ])('%s → %s', (error, expected) => {
    expect(classifyMailingSendError(error)).toBe(expected);
  });
});
