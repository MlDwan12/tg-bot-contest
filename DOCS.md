# Полная документация

## Содержание

1. [Архитектура](#архитектура)
2. [Модули](#модули)
3. [База данных](#база-данных)
4. [API Reference](#api-reference)
5. [Очереди и фоновые задачи](#очереди-и-фоновые-задачи)
6. [Аутентификация и авторизация](#аутентификация-и-авторизация)
7. [Жизненный цикл конкурса](#жизненный-цикл-конкурса)
8. [Система рассылок](#система-рассылок)
9. [Загрузка файлов](#загрузка-файлов)
10. [Логирование](#логирование)
11. [Мониторинг](#мониторинг)
12. [Переменные окружения](#переменные-окружения)
13. [Деплой](#деплой)

---

## Архитектура

```
┌─────────────────────────────────────────────┐
│                  NestJS API                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │   Auth   │  │ Contests │  │   Users   │  │
│  └──────────┘  └──────────┘  └───────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Channels │  │   Bot    │  │  Health   │  │
│  └──────────┘  └──────────┘  └───────────┘  │
│                    │                         │
│          ┌─────────┴─────────┐               │
│          │   BullMQ Queues   │               │
│          └─────────┬─────────┘               │
└────────────────────┼────────────────────────┘
           ┌─────────┼─────────┐
           ▼         ▼         ▼
      PostgreSQL   Redis    Telegram API
```

**Порт:** 3004  
**Формат ответов:** `{ data: <payload> }` (через ResponseInterceptor)  
**Ошибки:** `{ statusCode, message, error }`

---

## Модули

### `auth`
JWT-аутентификация с httpOnly-куками.

- `AuthService` — логин, генерация токенов, refresh-ротация
- `JwtStrategy` (Passport) — извлечение токена из куки `accessToken`
- `JwtAuthGuard` — защита роутов

### `bot`
Обёртка над Telegraf для взаимодействия с Telegram API.

- `BotService` — отправка сообщений, rate-limiting (Bottleneck)
- `BotUpdate` — обработчики команд `/start`, `/help`, callbacks
- `BotConstants` — ID администраторов, лимиты

### `users`
Управление пользователями и рассылки.

- `TelegramUserService` — CRUD Telegram-пользователей
- `AdminService` — создание/поиск администраторов
- `UsersMailingService` — запуск рассылок, постановка в очередь
- `MailingCleanupService` — удаление старых сообщений и заданий

### `contests`
Основная бизнес-логика конкурсов.

- `ContestsService` — создание, поиск, обновление конкурсов
- `ContestLifecycleService` — активация, завершение, отмена
- `ContestParticipateService` — логика участия
- `ContestWinnerService` — выбор победителей (random / manual)

### `channels`
Реестр Telegram-каналов для публикаций.

- `ChannelsService` — CRUD каналов
- `HealthService` — проверка прав бота в канале

### `health`
Readiness-проба для внешних систем.

- `RedisHealthIndicator` — ping Redis
- `BullMQHealthIndicator` — проверка доступности очередей

---

## База данных

### `users`

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | int PK | |
| `role` | enum | `user` / `admin` |
| `telegramId` | bigint unique | ID в Telegram |
| `username` | varchar | Telegram username |
| `firstName` | varchar | |
| `lastName` | varchar | |
| `login` | varchar unique | Логин администратора |
| `passwordHash` | varchar | bcrypt-хэш пароля |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

### `contests`

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | int PK | |
| `name` | varchar | Название конкурса |
| `description` | text | Описание |
| `imagePath` | varchar | Путь к изображению |
| `buttonText` | varchar | Текст кнопки участия |
| `status` | enum | `draft` / `pending` / `active` / `completed` / `cancelled` |
| `winnerStrategy` | enum | `random` / `manual` |
| `prizePlaces` | int | Количество призовых мест |
| `creatorId` | FK users | |
| `startDate` | timestamp | Дата начала |
| `endDate` | timestamp | Дата окончания |

### `contest_participants`

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | int PK | |
| `contestId` | FK contests | |
| `userId` | FK users | |
| `joinedAt` | timestamp | |
| `prizePlace` | int nullable | Призовое место |
| `isWinner` | boolean | |
| `groupId` | bigint | Telegram group ID |

### `contest_publications`

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | int PK | |
| `contestId` | FK contests | |
| `channelId` | FK channels | |
| `chatId` | bigint | Telegram chat ID |
| `telegramMessageId` | int nullable | ID сообщения в Telegram |
| `status` | enum | `pending` / `processing` / `published` / `failed` / `cancelled` |
| `payload` | JSONB | `{ text, photoUrl, buttonText, buttonUrl }` |
| `attempts` | int | Число попыток публикации |
| `error` | text nullable | Текст последней ошибки |

### `contest_winners`

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | int PK | |
| `contestId` | FK contests | |
| `userId` | FK users | |
| `place` | int | Место победителя |

### `channels`

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | int PK | |
| `telegramId` | bigint unique nullable | |
| `telegramUsername` | varchar unique nullable | |
| `name` | varchar | Название канала |
| `isActive` | boolean | |
| `type` | enum | `casino` / `other` |

### `mailing_jobs`

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | uuid PK | |
| `type` | varchar | Тип рассылки |
| `status` | enum | `pending` / `processing` / `completed` / `completed_with_errors` / `failed` |
| `totalRecipients` | int | |
| `queuedCount` | int | |
| `sentCount` | int | |
| `failedCount` | int | |
| `skippedCount` | int | |
| `text` | text | |
| `imagePath` | varchar nullable | |
| `buttonText` | varchar nullable | |
| `buttonUrl` | varchar nullable | |
| `startedAt` | timestamp | |
| `finishedAt` | timestamp nullable | |

### `mailing_messages`

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | int PK | |
| `mailingJobId` | FK mailing_jobs | |
| `userId` | FK users | |
| `telegramId` | bigint | |
| `chatId` | bigint | |
| `messageId` | int nullable | ID сообщения в Telegram |
| `sendStatus` | enum | `pending` / `sent` / `failed` |
| `sendError` | text nullable | |
| `sentAt` | timestamp nullable | |
| `deleteAfter` | timestamp nullable | Время автоудаления |
| `deleteStatus` | enum | `pending` / `deleted` / `failed` |

---

## API Reference

### Аутентификация

#### `POST /auth/login`
Лимит: 5 запросов / 15 мин.

**Body:**
```json
{
  "login": "admin",
  "password": "secret"
}
```

**Response 200:**
```json
{
  "data": { "message": "Успешный вход" }
}
```
Устанавливает httpOnly-куки: `accessToken` (15 мин), `refreshToken` (30 дн).

---

#### `GET /auth/logout`

Очищает куки. Response 200: `{ "data": { "message": "Вы вышли из системы" } }`

---

#### `GET /auth/me`
**Guard:** JWT

Response 200: данные текущего пользователя.

---

### Пользователи

#### `POST /users`
**Guard:** JWT  
Создать администратора.

**Body:**
```json
{
  "login": "admin2",
  "password": "secret123"
}
```

---

#### `GET /users`
Список всех пользователей с пагинацией.

**Query:** `limit`, `offset`

---

#### `GET /users/:id/details`
Детали пользователя + количество участий в конкурсах.

---

#### `POST /users/broadcast`
**Guard:** JWT  
**Content-Type:** `multipart/form-data`

| Поле | Тип | Описание |
|------|-----|---------|
| `type` | string | `USER` / `GROUP` / `ALL` |
| `userIds` | number[] | При `type=USER` |
| `groupId` | bigint | При `type=GROUP` |
| `text` | string | Текст сообщения |
| `media` | File | Изображение (необязательно) |
| `buttonText` | string | Текст кнопки (необязательно) |
| `buttonUrl` | string | URL кнопки (необязательно) |

**Response 200:**
```json
{
  "data": { "jobId": "uuid", "enqueuedCount": 150 }
}
```

---

### Конкурсы

#### `POST /contest`
**Guard:** JWT  
**Content-Type:** `multipart/form-data`

| Поле | Тип | Описание |
|------|-----|---------|
| `name` | string | Название |
| `description` | string | Описание |
| `startDate` | ISO string | Дата начала (> now) |
| `endDate` | ISO string | Дата окончания (> startDate) |
| `winnerStrategy` | string | `random` / `manual` |
| `prizePlaces` | number | Количество мест |
| `publishChannelIds` | number[] | Каналы для публикации |
| `requiredChannelIds` | number[] | Каналы для участия (подписка) |
| `buttonText` | string | Текст кнопки (необязательно) |
| `media` | File | Изображение (необязательно) |

---

#### `GET /contest`
**Guard:** JWT  
**Query:** `limit`, `offset`

---

#### `GET /contest/short-info`
Публичный список конкурсов (краткая информация).  
**Query:** `limit`, `offset`

---

#### `GET /contest/:id`
Детали конкурса с публикациями, участниками и победителями.

---

#### `POST /contest/:id/participate`
Участие в конкурсе.

**Body:**
```json
{ "groupId": 123456789 }
```

---

#### `PATCH /contest/:id`
**Guard:** JWT  
**Content-Type:** `multipart/form-data`  
Обновление конкурса (те же поля что и при создании, все необязательные).

---

#### `PATCH /contest/:id/complete`
**Guard:** JWT  
Завершить конкурс и выбрать победителей.

---

#### `PATCH /contest/:id/cancel`
**Guard:** JWT  
Отменить конкурс.

---

#### `DELETE /contest/:id`
**Guard:** JWT  
Удалить конкурс.

---

### Каналы

#### `POST /channels`
**Guard:** JWT

**Body:**
```json
{
  "telegramUsername": "@mychannel",
  "name": "Мой канал",
  "type": "other"
}
```

---

#### `GET /channels`
**Query:** `limit`, `offset`

---

#### `GET /channels/:id`

---

#### `DELETE /channels/:id`
**Guard:** JWT

---

### Служебные

#### `GET /health`
Проверка состояния: PostgreSQL, Redis, BullMQ.

```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "bullmq": { "status": "up" }
  }
}
```

#### `GET /admin/queues`
**Guard:** JWT (только `role=admin`)  
Bull Board — интерфейс управления очередями BullMQ.

---

## Очереди и фоновые задачи

### Очереди

| Очередь | Воркер | Назначение |
|---------|--------|-----------|
| `telegram-messages` | `MailingProcessor` | Отправка сообщений рассылки |
| `contest-scheduler` | `ContestPublishProcessor` | Запуск конкурса по расписанию |
| `contest-publication` | `ContestPublicationProcessor` | Публикация в каналы |
| `contest-finish` | `ContestFinishProcessor` | Завершение конкурса |
| `contest-maintenance` | `ContestMaintenanceProcessor` | Обслуживание зависших задач |

### `telegram-messages`

Отправляет одно сообщение одному пользователю в рамках рассылки.

- **Повторы:** 3 попытки, экспоненциальный backoff от 5с
- **Идемпотентность:** проверяет существование `mailing_messages` перед отправкой
- **По завершении:** обновляет `sentCount` / `failedCount` в `mailing_jobs`

### `contest-scheduler`

Запускается в момент `startDate` конкурса.

1. Переводит конкурс в статус `ACTIVE`
2. Берёт все `pending` публикации конкурса
3. Ставит в очередь `contest-publication` задачи `sendPublication`

### `contest-publication`

#### `sendPublication`
- **Повторы:** 10, backoff 5с
- **Rate limit:** Bottleneck (5 параллельных, мин. 60мс между запросами)
- **Ошибки:** 400/403 — постоянный сбой; 429 — задержка; остальные — retry
- **По успеху:** обновляет `ContestPublication.status = PUBLISHED`, сохраняет `telegramMessageId`

#### `updateFinishedButton`
Редактирует кнопку сообщения после окончания конкурса.
- **Повторы:** 10

### `contest-finish`

Запускается в момент `endDate`.

1. Проверяет, не завершён ли уже конкурс (идемпотентность)
2. Выбирает победителей по стратегии
3. Создаёт записи `ContestWinner`
4. Переводит статус в `COMPLETED`
5. Отправляет уведомления победителям через бота

### `contest-maintenance`

#### `requeueStalePublications`
Сбрасывает `PROCESSING → PENDING` для публикаций, застрявших > 10 мин.

#### `enqueuePendingPublications`
Ставит в очередь `sendPublication` для всех `PENDING` публикаций активных конкурсов.

---

## Аутентификация и авторизация

### Токены

| Параметр | Access Token | Refresh Token |
|---------|:---:|:---:|
| TTL | 15 мин | 30 дней |
| Хранение | httpOnly cookie | httpOnly cookie |
| Секрет | `JWT_ACCESS_SECRET` | `JWT_REFRESH_SECRET` |

**Payload:**
```json
{ "sub": 1, "role": "admin", "login": "admin" }
```

### Защита роутов

```typescript
@UseGuards(JwtAuthGuard)  // проверяет accessToken из куки
```

### Bull Board

Middleware в `main.ts` проверяет:
1. Наличие `accessToken` в куках
2. Роль `admin` в payload (403 для `user`)

### Rate limiting

| Область | Лимит |
|---------|-------|
| Глобальный | 100 req / 60 сек |
| `POST /auth/login` | 5 req / 15 мин |

---

## Жизненный цикл конкурса

```
Создание
  │
  ▼
PENDING ──── startDate ────► ACTIVE
  │                            │
  │ (отмена)                   │ (endDate или ручное завершение)
  ▼                            ▼
CANCELLED                  COMPLETED
```

### Шаги

1. **Создание** (`POST /contest`):
   - Сохраняется запись `Contest` со статусом `PENDING`
   - Создаются записи `ContestPublication` (по одной на каждый publish-канал)
   - Планируется BullMQ-задача `publishContest` на `startDate`

2. **Активация** (в `startDate`):
   - Статус → `ACTIVE`
   - Публикуется сообщение в каждый канал (через очередь `contest-publication`)
   - Планируется задача `finishContest` на `endDate`

3. **Участие** (`POST /contest/:id/participate`):
   - Проверяется подписка на `requiredChannels`
   - Создаётся `ContestParticipation`

4. **Завершение** (в `endDate`):
   - Статус → `COMPLETED`
   - Выбираются победители
   - Кнопки в постах редактируются (бот обновляет сообщения)

---

## Система рассылок

### Типы рассылок

| Тип | Получатели |
|-----|-----------|
| `USER` | Конкретные пользователи по `userIds` |
| `GROUP` | Все пользователи группы по `groupId` |
| `ALL` | Все пользователи в базе |

### Процесс

```
POST /users/broadcast
  │
  ▼
UsersMailingService.sendMailing()
  ├── Создаёт MailingJob (status: pending)
  ├── Создаёт MailingMessage для каждого получателя (status: pending)
  └── Ставит в очередь N задач telegram-messages
          │
          ▼ (параллельно, BullMQ)
      MailingProcessor
          ├── Проверяет идемпотентность
          ├── Отправляет сообщение через BotService
          ├── Обновляет MailingMessage (status: sent/failed)
          └── Обновляет счётчики MailingJob
                  │
                  ▼ (когда все обработаны)
          MailingJob.status = completed / completed_with_errors
```

### Автоудаление

`MailingCleanupService` (по расписанию) удаляет:
- Сообщения у пользователей через `deleteAfter` часов
- Записи `MailingJob` старше N дней

---

## Загрузка файлов

| Тип | Путь | Макс. размер | Форматы |
|-----|------|:---:|--------|
| Изображение конкурса | `/uploads/contests/` | 5 МБ | JPEG, PNG, WEBP |
| Медиа рассылки | `/uploads/mailings/` | 5 МБ | JPEG, PNG, WEBP, MP4, MOV, WEBM |

Файлы раздаются как статика через Express: `GET /uploads/<path>`.

---

## Логирование

**Библиотека:** nestjs-pino (pino-http)

### Уровни

| Уровень | Значение pino | Когда |
|---------|:---:|-------|
| `trace` | 10 | Детальная отладка |
| `debug` | 20 | Разработка |
| `info` | 30 | Штатные события |
| `warn` | 40 | Потенциальные проблемы |
| `error` | 50 | Ошибки |
| `fatal` | 60 | Критические сбои |

### Формат (production)

```json
{
  "level": 30,
  "time": 1749500000000,
  "pid": 1,
  "reqId": "uuid",
  "req": { "method": "POST", "url": "/contest" },
  "res": { "statusCode": 201 },
  "msg": "request completed"
}
```

### Конфигурация

| Переменная | Описание |
|-----------|---------|
| `LOG_LEVEL` | Минимальный уровень (`debug` в dev, `info` в prod) |
| `LOG_PRETTY` | Форматированный вывод (только для dev) |
| `LOG_REDACT` | Поля для скрытия (через запятую) |

**Скрываются всегда:** `req.headers.authorization`, `req.headers.cookie`, `req.body.password`, `req.body.token`

**Не логируются:** `GET /health`, `GET /ping`

---

## Мониторинг

### Сервисы

| Сервис | Порт | Описание |
|--------|:----:|---------|
| Grafana | 3001 | Дашборды: `API Logs` (Loki), `Node Exporter Full` (Prometheus) |
| Prometheus | 9090 | Хранение метрик (retention: 30 дней) |
| Loki | 3100 | Хранение логов (retention: 7 дней) |
| Node Exporter | 9100 | Метрики хоста: CPU, RAM, диск, сеть |

### Grafana дашборды

| Дашборд | ID | Datasource | Описание |
|---------|:--:|:----------:|---------|
| API Logs | `app-logs-v1` | Loki | Логи приложения по уровням, ошибки |
| Node Exporter Full | `1860` | Prometheus | Метрики сервера |

### Запросы Loki

```logql
# Все логи приложения
{service="api"}

# Только ошибки
{service="api", level="error"}

# Конкретный запрос по reqId
{service="api"} | json | reqId="<uuid>"

# Ошибки и предупреждения с деталями
{service="api", level=~"error|warn"} | json
```

### Провизионирование Grafana

```
monitoring/grafana/provisioning/
├── datasources/
│   ├── loki.yml         # Loki datasource (uid: loki)
│   └── prometheus.yml   # Prometheus datasource
└── dashboards/
    ├── dashboards.yml   # Provider config
    └── app-logs.json    # API Logs dashboard
```

---

## Переменные окружения

### Обязательные

```env
JWT_ACCESS_SECRET=         # мин. 32 символа
JWT_REFRESH_SECRET=        # мин. 32 символа
TELEGRAM_BOT_TOKEN=        # от @BotFather
ADMIN_IDS=                 # Telegram ID через запятую

DATABASE_HOST=
DATABASE_PORT=5432
DATABASE_USER=
DATABASE_PASSWORD=
DATABASE_NAME=

REDIS_HOST=
REDIS_PORT=6379
BULL_PREFIX=               # префикс ключей в Redis
```

### Необязательные

```env
PORT=3004
NODE_ENV=development
LOG_LEVEL=info
LOG_PRETTY=false
LOG_REDACT=                # дополнительные поля для скрытия
REDIS_PASSWORD=
REDIS_DB=0
SENTRY_DSN=
MINI_APP_URL=              # URL Mini App для кнопки участия
GRAFANA_PASSWORD=changeme
```

---

## Деплой

### Docker Compose

```bash
# Запустить все сервисы
docker compose up -d

# Применить миграции
docker compose exec api yarn migration:run

# Логи
docker compose logs -f api
```

### Сервисы в docker-compose

```
postgres    — tg_postgres
redis       — tg_redis
api         — tg_api (порт 3004)
node-exporter — tg_node_exporter (порт 9100, host network)
prometheus  — tg_prometheus (порт 9090)
loki        — tg_loki (порт 3100)
promtail    — tg_promtail
grafana     — tg_grafana (порт 3001)
```

### Volumes

| Volume | Назначение |
|--------|-----------|
| `postgres_data` | Данные PostgreSQL |
| `loki_data` | Данные Loki |
| `grafana_data` | Конфигурация и дашборды Grafana |
| `prometheus_data` | Метрики Prometheus |

### Проверка работоспособности

```bash
# Health check
curl http://localhost:3004/health

# Prometheus targets
curl http://localhost:9090/api/v1/targets | jq '.data.activeTargets[].health'

# Loki streams
curl "http://localhost:3100/loki/api/v1/label/service/values"
```
