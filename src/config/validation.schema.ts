import * as Joi from 'joi';

export const validationSchema = Joi.object({
  // CORE
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // TELEGRAM
  TELEGRAM_BOT_TOKEN: Joi.string().required(),
  // Старый бот на время переезда: шлёт личку (рассылки, уведомления) тем, кто
  // ещё не нажал /start в новом, и отвечает «мы переехали». Убрать — личка
  // уйдёт через TELEGRAM_BOT_TOKEN. Перед удалением вычистить его рассылки:
  // удалить сообщение может только отправивший бот.
  LEGACY_BOT_TOKEN: Joi.string().optional(),
  // true — участие только с подписью Mini App (initData). Включать, когда фронт
  // начнёт её слать; до этого запросы без подписи проходят как раньше.
  REQUIRE_TELEGRAM_INIT_DATA: Joi.boolean().default(false),

  // DATABASE
  DATABASE_HOST: Joi.string().hostname().default('localhost'),
  DATABASE_PORT: Joi.number().port().default(5432),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),
  DATABASE_SCHEMA: Joi.string().default('public'),

  // LOGGING
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
  LOG_PRETTY: Joi.boolean().default(false),
  LOG_REDACT: Joi.string().optional(),

  // REDIS
  REDIS_HOST: Joi.string().hostname().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().integer().min(0).max(15).default(0),

  // ОТЧЁТ ПО РАССЫЛКАМ — после крона удаления статистика уходит во внешний
  // API. URL или ключ не заданы — отправка выключена, остальное работает.
  MAILING_STATS_URL: Joi.string().uri().optional(),
  MAILING_STATS_API_KEY: Joi.string().optional(),
  // Типы рассылок для отчёта, через запятую (USER, GROUP, ALL).
  MAILING_STATS_TYPES: Joi.string().default('ALL'),

  // JWT — объявляем явно чтобы приложение падало при старте
  // если секреты не заданы, а не в рантайме при первом запросе.
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
});
