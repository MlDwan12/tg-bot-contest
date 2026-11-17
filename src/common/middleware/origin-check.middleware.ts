import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Защита от CSRF. Куки сессии — SameSite=None, поэтому форма или fetch с
 * чужого сайта уходят вместе с куками админа (простые запросы — без preflight,
 * CORS их не останавливает: запрос выполняется, просто ответ не читается).
 *
 * На изменяющих запросах браузер всегда шлёт Origin: если он не из списка
 * CORS — отказ. Без Origin (curl, сервер-сервер, Telegram) — пропускаем:
 * у таких клиентов нет чужих кук, CSRF им не грозит.
 */
export function originCheck(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (
      SAFE_METHODS.has(req.method) ||
      !origin ||
      allowed.has(origin) ||
      // Свой же домен API (Bull Board, Swagger) — не межсайтовый запрос
      isSameHost(origin, req)
    ) {
      next();
      return;
    }
    res.status(403).json({
      success: false,
      status: 403,
      data: { message: 'Forbidden: origin not allowed' },
    });
  };
}

function isSameHost(origin: string, req: Request): boolean {
  try {
    // Host/X-Forwarded-Host чужая страница не подделает: форма их не задаёт,
    // а fetch со своим заголовком идёт через preflight и режется CORS
    return (
      new URL(origin).host === req.get('x-forwarded-host') ||
      new URL(origin).host === req.get('host')
    );
  } catch {
    return false;
  }
}
