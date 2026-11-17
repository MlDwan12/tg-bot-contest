import { originCheck } from './origin-check.middleware';

function run(method: string, headers: Record<string, string>) {
  const middleware = originCheck(['https://rollcu.ru']);
  const req = {
    method,
    headers,
    get: (name: string) => headers[name.toLowerCase()],
  };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  middleware(req as any, res as any, next);
  return { next, res };
}

describe('originCheck (CSRF)', () => {
  it('POST с чужого сайта — 403', () => {
    const { next, res } = run('POST', {
      origin: 'https://evil.example',
      host: 'api.rollcu.ru',
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('POST с фронта из списка CORS — пропускаем', () => {
    expect(
      run('POST', { origin: 'https://rollcu.ru' }).next,
    ).toHaveBeenCalled();
  });

  it('POST со своего домена API (Bull Board) — пропускаем', () => {
    expect(
      run('POST', { origin: 'https://api.rollcu.ru', host: 'api.rollcu.ru' })
        .next,
    ).toHaveBeenCalled();
  });

  it('без Origin (curl, сервер) и GET с чужого сайта — пропускаем', () => {
    expect(run('POST', {}).next).toHaveBeenCalled();
    expect(
      run('GET', { origin: 'https://evil.example' }).next,
    ).toHaveBeenCalled();
  });
});
