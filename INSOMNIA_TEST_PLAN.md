# План ручного тестирования API через Insomnia

Полный чек-лист для проверки всех ручек Telegram Bot API: happy-path + негативные и граничные кейсы. Коллекция запросов — `insomnia-collection.json` (импортируй в Insomnia).

---

## 0. Предусловия

| Что | Значение |
|---|---|
| Коллекция | `insomnia-collection.json` (Import → From File) |
| `base_url` (докерный API) | `http://localhost:3004` |
| `base_url` (хостовый `yarn start:dev`) | `http://localhost:3000` |
| Авторизация | httpOnly cookie `accessToken` + `refreshToken`, ставятся на `POST /auth/login`. Insomnia хранит их в cookie jar и подставляет автоматически. |

**Перед стартом проверь инфраструктуру:**
- `GET /health` → `200`, все индикаторы `up` (database, redis, bullmq).
- Если тестируешь хостовый экземпляр — Postgres (`5432`) и Redis (`6379`) должны быть проброшены на хост.

### Формат ответов (важно для проверки)

Глобальный `ResponseInterceptor` оборачивает **любой** успешный ответ:
```json
{ "success": true, "status": 200, "data": <payload> }
```
Глобальный `AllExceptionsFilter` оборачивает **любую** ошибку:
```json
{ "success": false, "status": 400, "data": <сообщение | объект валидации> }
```
Проверяй не только HTTP-код, но и `success`/`status` в теле.

### Пагинация (`data` у списков)
```json
{ "items": [...], "total": N, "page": 1, "limit": 10, "totalPages": N, "hasNextPage": bool, "hasPrevPage": bool }
```

### Глобальные правила валидации
- `whitelist: true` + `forbidNonWhitelisted: true` → **любое лишнее поле в теле → `400`**.
- `transform: true` → строки из query/form приводятся к числам/датам согласно DTO.
- Throttle: глобально **100 запросов / 60с** на IP; на `/auth/login` — **5 / 15 мин**.

---

## 1. Порядок прохождения (E2E-цепочка)

Ручки зависят друг от друга — иди по порядку, сохраняя id из ответов в переменные окружения (`channel_id`, `contest_id`, `user_id`):

1. `GET /health` — инфраструктура жива.
2. `POST /users` (или уже существующий админ) — создать администратора.
3. `POST /auth/login` — получить cookie-сессию.
4. `GET /auth/me` — сессия валидна.
5. `POST /channels` — создать канал, запомнить `id` → `channel_id`.
6. `POST /contest` — создать конкурс с `requiredChannelIds`/`publishChannelIds` = `[channel_id]`, запомнить `id` → `contest_id`.
7. `GET /contest/:id`, `GET /contest`, `GET /contest/short-info` — чтение.
8. `POST /contest/:id/participate` — участие (см. нюансы статусов).
9. `GET /users`, `GET /users/:id/details` — пользователь появился.
10. `PATCH /contest/:id/complete` или `/cancel` — жизненный цикл.
11. `POST /users/broadcast` — рассылка.
12. `DELETE /contest/:id`, `DELETE /channels/:id` — очистка.
13. `GET /auth/logout` — выход.

---

## 2. Health

| # | Запрос | Ожидание |
|---|---|---|
| H1 | `GET /health` | `200`, `data.status = "ok"`, info по database/redis/bullmq = `up` |
| H2 | Останови Redis, повтори | `503`, `data` содержит `error` c redis (не забудь поднять обратно) |

> `@SkipThrottle` — health не лимитируется, можно долбить.

---

## 3. Auth

| # | Запрос | Тело | Ожидание |
|---|---|---|---|
| A1 | `POST /auth/login` happy | верные `username`/`password` | `201/200`, `data.message = "Успешный вход"`, в ответе `Set-Cookie: accessToken`, `refreshToken` |
| A2 | login — неверный пароль | правильный логин, чужой пароль | `401`, `data = "Неверные учетные данные"` |
| A3 | login — несуществующий пользователь | случайный логин | `401`, `Неверные учетные данные` |
| A4 | login — нет поля | `{ "username": "x" }` (без password) | `400`, ошибка валидации `password must be a string` |
| A5 | login — лишнее поле | `{...verno, "hack": 1}` | `400` (forbidNonWhitelisted) |
| A6 | login — брутфорс | 6 раз подряд неверный логин | 6-й запрос → `429 Too Many Requests` |
| A7 | `GET /auth/me` с валидной cookie | — | `200`, `data.success = true` |
| A8 | `GET /auth/me` без cookie | удали cookie в Insomnia / инкогнито | `401` |
| A9 | `GET /auth/me` с протухшим/битым токеном | подделай cookie | `401` |
| A10 | `GET /auth/logout` | — | `200`, `data.message = "Вы успешно вышли..."`, cookie очищены |
| A11 | после logout → `GET /auth/me` | — | `401` |

> После A6 подожди 15 минут или тестируй с другого IP — лимит по IP.

---

## 4. Channels

### Создание — `POST /channels` 🔒
| # | Тело | Ожидание |
|---|---|---|
| C1 | `{telegramId: -100123.., telegramUsername, name, type:"casino"}` | `201`, `data` = созданный канал, запомни `id` |
| C2 | минимум: `{telegramId: 123}` | `201`, `type` по умолчанию `casino` |
| C3 | без `telegramId` | `400` (`telegramId` обязателен, IsNumber) |
| C4 | `telegramId: "abc"` (строка-нечисло) | `400` |
| C5 | `type: "poker"` (не из enum) | `400` (enum: `casino`\|`other`) |
| C6 | лишнее поле `{telegramId:1, foo:1}` | `400` (forbidNonWhitelisted) |
| C7 | без авторизации (нет cookie) | `401` |

### Чтение — `GET /channels`
| # | Query | Ожидание |
|---|---|---|
| C8 | `?page=1&limit=10` | `200`, пагинированный список |
| C9 | `?type=casino` | `200`, только casino |
| C10 | `?isActive=true` | `200`, только активные |
| C11 | `?limit=1000` | `400` (max 100) |
| C12 | `?page=0` | `400` (min 1) |
| C13 | `?type=xxx` | `400` (enum) |

### По id / удаление
| # | Запрос | Ожидание |
|---|---|---|
| C14 | `GET /channels/:id` существующий | `200`, канал |
| C15 | `GET /channels/999999` | `404`, `Channel with id=999999 not found` |
| C16 | `GET /channels/abc` | `400` (ParseIntPipe) |
| C17 | `DELETE /channels/:id` 🔒 | `200`, канал удалён |
| C18 | `DELETE /channels/:id` без cookie | `401` |
| C19 | `GET /channels/:id` после удаления | `404` |

---

## 5. Contests

### Создание — `POST /contest` 🔒 (multipart/form-data)
Обязательные: `name`, `winnerStrategy` (`random`\|`manual`), `prizePlaces` (int ≥1), `startDate`, `endDate` (обе — в будущем, ISO). `media` — опциональный файл.

| # | Данные | Ожидание |
|---|---|---|
| K1 | все валидные поля, `startDate`/`endDate` в будущем | `201`, `data` = конкурс, запомни `id` |
| K2 | + файл `media` (jpeg/png) | `201`, у конкурса `imagePath` |
| K3 | `publishChannelIds=[channel_id]`, `requiredChannelIds=[channel_id]` | `201`, связи проставлены |
| K4 | без `name` | `400` |
| K5 | `name` длиннее 255 | `400` (MaxLength) |
| K6 | `winnerStrategy="foo"` | `400` (enum) |
| K7 | `prizePlaces=0` | `400` (min 1) |
| K8 | `startDate` в прошлом (напр. `2020-01-01`) | `400` `startDate must not be in the past` |
| K9 | `endDate` в прошлом | `400` `endDate must not be in the past` |
| K10 | `publishChannelIds="[1,abc]"` | `400` `Некорректное значение в массиве id` |
| K11 | `publishChannelIds="1,2,3"` (CSV) | `201` (парсер принимает CSV) |
| K12 | без авторизации | `401` |

### Чтение
| # | Запрос | Ожидание |
|---|---|---|
| K13 | `GET /contest` 🔒 | `200`, пагинация |
| K14 | `GET /contest` без cookie | `401` |
| K15 | `GET /contest?status=active&sortBy=createdAt&sortOrder=DESC` | `200`, отфильтровано |
| K16 | `GET /contest?status=xxx` | `400` (enum) |
| K17 | `GET /contest?sortBy=foo` | `400` (enum `ContestSortBy`) |
| K18 | `GET /contest/short-info` (публичный) | `200`, короткие DTO |
| K19 | `GET /contest/:id` | `200`, полный конкурс |
| K20 | `GET /contest/999999` | `404` `Конкурс не найден` |
| K21 | `GET /contest/abc` | `400` (ParseIntPipe) |

### Обновление — `PATCH /contest/:id` 🔒 (multipart)
| # | Данные | Ожидание |
|---|---|---|
| K22 | `{name:"new"}` | `200`, обновлён |
| K23 | `status="active"` | `200` (перевод статуса) |
| K24 | `winners='[{"telegramId":111},{"username":"@ivan_petrov"}]'` (НОВЫЙ формат — объекты) | `200`/`400` по бизнес-правилам. Полный флоу и все кейсы — раздел **🆕 Фиктивные победители** ниже |
| K25 | без cookie | `401` |
| K26 | несуществующий id | `404` |

> **⚠️ Смена контракта `winners`:** раньше был массив чисел (`[1,2]` = telegramId). Теперь — **массив объектов**: `{ "telegramId": 111 }` (реальный) ИЛИ `{ "username": "ник" }` (выдуманный, без TG-аккаунта). Ровно одно поле у элемента. Фронт обязан обновиться.

### 🆕 Фиктивные победители (ручной выбор) — группа `F1…F14` в Insomnia

**Что проверяем:** при MANUAL-стратегии оператор может назначить победителем либо реального юзера (`{telegramId}`), либо выдуманный ник без TG-аккаунта (`{username}`). Выдуманный сохраняется без привязки к `users` и показывается как обычный победитель (без маскировки, полным ником).

**Формат `winners`** (multipart-поле, JSON-строка): массив объектов, у каждого **ровно одно** поле:
```json
[{ "telegramId": 111 }, { "username": "@ivan_petrov" }]
```

**Порядок прохождения (запускай запросы F1→F14 по очереди):**

1. Залогинься (группа **Auth → POST /auth/login**) — кука ставится автоматически.
2. **F1** создаёт MANUAL-конкурс (PENDING). Возьми `data.id` из ответа и впиши в environment → `contest_id`.
3. **F2** переводит его в `ACTIVE` (`status=active`). **Обязательно до назначения** — на PENDING будет `400`.
4. **F3** заводит реального юзера с `telegramId=111` (через participate) — он нужен как реальный победитель.
5. **F4…F12** — назначение победителей, кейсы ниже.
6. **F5** (GET) — визуально проверь форму `winners` в ответе.
7. **F13** завершает конкурс, **F14** дёргает participate по завершённому — победители уходят наружу.

| # | Запрос | Данные | Ожидание |
|---|---|---|---|
| F4 | PATCH ✅ смешанные | `[{telegramId:111},{username:"@ivan_petrov"}]`, `prizePlaces=2` | `200`. Место1 — реальный (111), место2 — фиктивный (`userId=null`, `displayUsername="ivan_petrov"`, `@` снят) |
| F6 | PATCH ✅ все выдуманные | `[{username:"@masha"},{username:"vasya"}]`, `prizePlaces=2` | `200`. Оба `userId=null` |
| F7 | PATCH ❌ оба поля | `[{telegramId:111,username:"x"},...]` | `400` «…либо telegramId, либо ник, но не оба» |
| F8 | PATCH ❌ ни одного поля | `[{},{username:"y"}]` | `400` «…не указан ни telegramId, ни ник» |
| F9 | PATCH ❌ дубли ников | `[{username:"Ivan"},{username:"ivan"}]` | `400` «…содержит дубликаты» (регистронезависимо) |
| F10 | PATCH ❌ кол-во ≠ мест | `[{username:"solo"}]`, `prizePlaces=2` | `400` «…соответствовать количеству призовых мест» |
| F11 | PATCH ❌ реальный не найден | `[{telegramId:999999},{username:"x"}]` | `404` «Не найдены пользователи с telegramId: 999999» |
| F12 | PATCH ❌ пустой ник | `[{username:"@"},{username:"y"}]` | `400` «Ник победителя не может быть пустым» |

**F5 — проверка GET `/contest/:id`** (после F4). В `winners`:
- реальный: `{ userId:111-юзер, place:1, user:{ telegramId:111, username:"real_user" } }`;
- фиктивный: `{ userId:null, place:2, user:{ id:null, telegramId:null, username:"ivan_petrov" } }` — синтетический `user`, фронт рисует тем же кодом.

**F14 — participate по завершённому** возвращает список победителей; фиктивный: `{ place, telegramId:null, userId:null, username:"<ник>" }`.

**Отдельно (не в группе): кейс PENDING → 400.** Создай ещё один конкурс (F1), **НЕ** делай F2, сразу пошли F4 → `400` «Нельзя назначить победителей до старта конкурса».

### Участие — `POST /contest/:contestId/participate` (публичный)
Зависит от **статуса** конкурса:

| # | Статус конкурса | Тело | Ожидание |
|---|---|---|---|
| K27 | `ACTIVE`, без required-каналов | `{telegramId:"123", groupId:"g1"}` | `200/201`, участие засчитано |
| K28 | `ACTIVE` + required-каналы, юзер не подписан | то же | `403` `Необходимо подписаться на обязательные каналы: ...` |
| K29 | `PENDING` (ещё не стартовал) | — | `400` `Конкурс ещё не начался` |
| K30 | `COMPLETED` | — | `200`, `data` = список победителей (не ошибка!) |
| K31 | `CANCELLED` или `DRAFT` | — | `404` `Конкурс не найден` |
| K32 | без `telegramId` | `{groupId:"g1"}` | `400` |
| K33 | без `groupId` | `{telegramId:"1"}` | `400` |
| K34 | `telegramId` числом вместо строки | `{telegramId: 1, ...}` | `400` (IsString) |

### Жизненный цикл 🔒
| # | Запрос | Предусловие | Ожидание |
|---|---|---|---|
| K35 | `PATCH /contest/:id/complete` | конкурс `ACTIVE`, старт прошёл | `200`, статус `completed`, выбраны победители |
| K36 | complete у уже завершённого | статус `COMPLETED` | `400` `Конкурс уже завершён` |
| K37 | complete у отменённого | `CANCELLED` | `400` `Нельзя завершить отменённый конкурс` |
| K38 | complete до старта | `startDate` в будущем | `400` `Нельзя завершить конкурс до его старта` |
| K39 | complete несуществующего | id=999999 | `404` `Конкурс не найден` |
| K40 | `PATCH /contest/:id/cancel` | активный/pending | `200`, статус `cancelled` |
| K41 | cancel завершённого | `COMPLETED` | `400` `Нельзя отменить завершённый конкурс` |
| K42 | cancel уже отменённого | `CANCELLED` | `400` `Конкурс уже отменён` |
| K43 | любой lifecycle без cookie | — | `401` |

### Удаление
| # | Запрос | Ожидание |
|---|---|---|
| K44 | `DELETE /contest/:id` 🔒 | `200` |
| K45 | без cookie | `401` |
| K46 | несуществующий | `404` |

---

## 6. Users

### Создание админа — `POST /users` 🔒
Правила: `login` 3–20 символов; `password` 8–50, обязательно буква + цифра.

| # | Тело | Ожидание |
|---|---|---|
| U1 | `{login:"admin_user", password:"StrongPass123"}` | `201`, `data` = юзер |
| U2 | дубль логина | `{login:"admin_user", ...}` повторно | `409` `Admin with this login already exists` |
| U3 | `login:"ab"` (<3) | `400` |
| U4 | `login` >20 симв | `400` |
| U5 | `password:"short1"` (<8) | `400` |
| U6 | `password:"onlyletters"` (нет цифры) | `400` `должен содержать хотя бы одну букву и одну цифру` |
| U7 | `password:"12345678"` (нет буквы) | `400` |
| U8 | лишнее поле | `400` (forbidNonWhitelisted) |
| U9 | без cookie | `401` |

### Чтение
| # | Запрос | Ожидание |
|---|---|---|
| U10 | `GET /users?page=1&limit=10` | `200`, пагинация с `totalParticipations` |
| U11 | `GET /users?search=<username>` | `200`, отфильтровано |
| U12 | `GET /users?group=<groupId>` | `200`, по группе |
| U13 | `GET /users?limit=1000` | `400` (max 100) |
| U14 | `GET /users/admin/:id` 🔒 | `200`, админ или `null` |
| U15 | `GET /users/admin/:id` без cookie | `401` |
| U16 | `GET /users/user/:id` (публичный) | `200`, tg-юзер или `null` |
| U17 | `GET /users/:id/details` | `200`, `{groups, contests}` |
| U18 | `GET /users/999999/details` | `404` `User with id=999999 not found` |
| U19 | `GET /users/abc/details` | `400` (ParseIntPipe) |

### Рассылка — `POST /users/broadcast` 🔒 (multipart)
`type`: `USER` \| `GROUP` \| `ALL`. Условная валидация:
- `text` обязателен, если **нет** `contestId`;
- `userId` обязателен для `type=USER`;
- `groupId` обязателен для `type=GROUP`;
- `buttonText`/`buttonUrl` — либо оба, либо ни одного (если нет `contestId`).
- `media` — опциональный файл (jpeg/png/webp/mp4/mov/webm, ≤5 МБ).

| # | Данные | Ожидание |
|---|---|---|
| B1 | `type=ALL, text="привет"` | `200`, `{jobId, enqueuedCount}` |
| B2 | `type=USER, userId=<id>, text="hi"` | `200` |
| B3 | `type=GROUP, groupId="g1", text="hi"` | `200` |
| B4 | `type=USER` без `userId` | `400` |
| B5 | `type=GROUP` без `groupId` | `400` |
| B6 | без `text` и без `contestId` | `400` |
| B7 | `type=ALL, contestId=<id>` (без text) | `200` (text не нужен при contestId) |
| B8 | `buttonText` без `buttonUrl` (без contestId) | `400` |
| B9 | `buttonUrl` невалидный | `400` `buttonUrl must be a valid URL` |
| B10 | `type="SMS"` (не enum) | `400` |
| B11 | файл `media` 6 МБ | `400`/`413` (лимит 5 МБ) |
| B12 | файл `media` неверного mime (напр. .pdf) | `400` `Only jpeg/png/webp allowed` |
| B13 | без cookie | `401` |

> Примечание: `AfterMoscowTimeGuard` на broadcast **закомментирован** — ограничения по времени сейчас нет. После рассылки загляни в Bull Board (`/admin/queues`), что задачи встали в очередь `telegram-messages`.

---

## 7. Admin — Bull Board

| # | Запрос | Ожидание |
|---|---|---|
| Q1 | `GET /admin/queues` с cookie админа | `200`, HTML-дашборд (лучше открыть в браузере) |
| Q2 | без cookie | `401` `Unauthorized: no session` |
| Q3 | cookie с `role != admin` | `403` `Forbidden: admin only` |
| Q4 | битый токен | `401` `Unauthorized: invalid session` |

> Bull Board — это отдельный express-middleware вне Nest, поэтому envelope `{success,...}` тут не применяется — ответы «сырые».

---

## 8. Кросс-функциональные проверки

| # | Что проверяем | Как | Ожидание |
|---|---|---|---|
| X1 | Единый конверт успеха | любой `200` | тело `{success:true, status, data}` |
| X2 | Единый конверт ошибки | любой `4xx` | тело `{success:false, status, data}` |
| X3 | Глобальный throttle | >100 запросов/мин на публичную ручку | `429` |
| X4 | CORS | запрос с `Origin: https://rollcu.ru` | заголовки CORS присутствуют |
| X5 | Cookie httpOnly | глянуть `Set-Cookie` после login | флаги `HttpOnly` (в проде ещё `Secure`) |
| X6 | Статика | `GET /uploads/<файл>` после загрузки media | файл отдаётся |

---

## 9. Очистка после тестов
1. `DELETE /contest/:id` — удалить созданные конкурсы.
2. `DELETE /channels/:id` — удалить созданные каналы.
3. Тестовых админов из `POST /users` удалить нельзя через API — при необходимости чисти в БД вручную.
4. `GET /auth/logout`.

---

## Чек-лист покрытия

- [ ] Health (2)
- [ ] Auth: login/me/logout + негативы + throttle (11)
- [ ] Channels: CRUD + валидация + auth (19)
- [ ] Contests: CRUD + участие + жизненный цикл + валидация (46)
- [ ] Users: создание + чтение + рассылка (19+13)
- [ ] Admin / Bull Board (4)
- [ ] Кросс-функциональные (6)
