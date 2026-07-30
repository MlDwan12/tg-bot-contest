import * as Joi from 'joi';
import { DEFAULT_APP_TIME_ZONE } from 'src/common/helpers/app-timezone.helper';

export const validationSchema = Joi.object({
  // CORE
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // Часовой пояс приложения: в нём трактуются даты конкурсов с фронта и
  // считается расписание крон-задач. Проверяем, что зона существует — опечатка
  // вроде 'Europe/Moskow' иначе всплыла бы не при старте, а кривыми датами
  // конкурсов, и заметили бы её далеко не сразу.
  APP_TIME_ZONE: Joi.string()
    .default(DEFAULT_APP_TIME_ZONE)
    .custom((value: string, helpers) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return value;
      } catch {
        return helpers.error('any.invalid');
      }
    }, 'IANA time zone')
    .messages({
      'any.invalid':
        'APP_TIME_ZONE должен быть именем зоны IANA, например Europe/Moscow',
    }),

  // TELEGRAM
  TELEGRAM_BOT_TOKEN: Joi.string().required(),

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

  // JWT — объявляем явно чтобы приложение падало при старте
  // если секреты не заданы, а не в рантайме при первом запросе.
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
});
