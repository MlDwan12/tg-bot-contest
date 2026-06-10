# Telegram Contest Bot

Система управления конкурсами в Telegram-каналах. Позволяет создавать конкурсы, публиковать их в каналах, отслеживать участников и выбирать победителей. Включает систему массовых рассылок и полный стек мониторинга.

## Стек

| Слой | Технологии |
|------|-----------|
| Backend | NestJS 11, TypeScript |
| База данных | PostgreSQL 16 + TypeORM |
| Очереди | BullMQ + Redis 7 |
| Бот | Telegraf + nestjs-telegraf |
| Мониторинг | Prometheus, Loki, Grafana, Promtail |
| Аутентификация | JWT (httpOnly cookies) |

## Быстрый старт

```bash
# Установка зависимостей
yarn install

# Копировать и заполнить переменные окружения
cp .env.development .env

# Запустить миграции
yarn migration:run

# Запуск в режиме разработки
yarn start:dev
```

## Docker

```bash
docker compose up -d
```

Сервис поднимается на `http://localhost:3004`.

## Переменные окружения

| Переменная | Обязательная | Описание |
|-----------|:---:|---------|
| `PORT` | | Порт приложения (по умолчанию 3004) |
| `NODE_ENV` | | `development` / `production` |
| `JWT_ACCESS_SECRET` | ✓ | Секрет для access-токена (мин. 32 символа) |
| `JWT_REFRESH_SECRET` | ✓ | Секрет для refresh-токена (мин. 32 символа) |
| `TELEGRAM_BOT_TOKEN` | ✓ | Токен бота от @BotFather |
| `ADMIN_IDS` | ✓ | Telegram ID администраторов (через запятую) |
| `DATABASE_HOST` | ✓ | Хост PostgreSQL |
| `DATABASE_USER` | ✓ | Пользователь PostgreSQL |
| `DATABASE_PASSWORD` | ✓ | Пароль PostgreSQL |
| `DATABASE_NAME` | ✓ | Имя базы данных |
| `REDIS_HOST` | ✓ | Хост Redis |
| `REDIS_PORT` | ✓ | Порт Redis |
| `SENTRY_DSN` | | DSN для Sentry (опционально) |
| `LOG_LEVEL` | | `debug` / `info` / `warn` / `error` |

## API

| Метод | Путь | Описание | Защита |
|-------|------|---------|:------:|
| `POST` | `/auth/login` | Вход | — |
| `GET` | `/auth/logout` | Выход | — |
| `GET` | `/auth/me` | Текущий пользователь | JWT |
| `POST` | `/users` | Создать администратора | JWT |
| `GET` | `/users` | Список пользователей | — |
| `POST` | `/users/broadcast` | Массовая рассылка | JWT |
| `POST` | `/contest` | Создать конкурс | JWT |
| `GET` | `/contest` | Список конкурсов | JWT |
| `POST` | `/contest/:id/participate` | Участвовать | — |
| `PATCH` | `/contest/:id/complete` | Завершить и выбрать победителей | JWT |
| `POST` | `/channels` | Добавить канал | JWT |
| `GET` | `/channels` | Список каналов | — |
| `GET` | `/health` | Проверка состояния сервиса | — |
| `GET` | `/admin/queues` | Bull Board — управление очередями | JWT (admin) |

## Мониторинг

| Сервис | URL | Описание |
|--------|-----|---------|
| Grafana | `:3001` | Дашборды логов и метрик |
| Prometheus | `:9090` | Метрики сервера |
| Bull Board | `:3004/admin/queues` | Состояние очередей |

## Миграции

```bash
# Применить
yarn migration:run

# Создать новую
yarn migration:generate src/database/migrations/migration_name

# Откатить
yarn migration:revert
```

## Документация

Полная документация — [DOCS.md](./DOCS.md).
