# Тест-план: Telegram Bot API

> Перед началом: импортируй `insomnia-collection.json` в Insomnia и настрой `base_url` в Base Environment.

---

## Блок 0 — Инфраструктура

- [ ] `GET /health` → `{ status: "ok" }`, все сервисы `up` (PostgreSQL, Redis, BullMQ)

---

## Блок 1 — Auth

### 1.1 Успешная авторизация
- [ ] `POST /auth/login` с правильными `username` / `password` → `200 { message: "Успешный вход" }`
- [ ] Куки `accessToken` и `refreshToken` установлены в Insomnia

### 1.2 Проверка сессии
- [ ] `GET /auth/me` (с куки) → `200 { success: true }`

### 1.3 Без авторизации
- [ ] Удали cookie в Insomnia → `GET /auth/me` → `401`

### 1.4 Неверный пароль
- [ ] `POST /auth/login` с неверным паролем → `401`

### 1.5 Выход
- [ ] `GET /auth/logout` → `200`
- [ ] `GET /auth/me` после выхода → `401`
- [ ] Снова залогинься перед следующими блоками

---

## Блок 2 — Channels

### 2.1 Создание каналов
- [ ] `POST /channels` → канал для публикации конкурса
  ```json
  { "telegramId": -1001234567890, "telegramUsername": "pub_channel", "name": "Публикация" }
  ```
  → `201`. Сохрани `id` как `channel_id`
- [ ] `POST /channels` → канал для обязательной подписки
  ```json
  { "telegramId": -1009999999999, "telegramUsername": "req_channel", "name": "Обязательный" }
  ```
  → `201`. Сохрани `id` как `required_channel_id`

### 2.2 Получение
- [ ] `GET /channels` → список, оба канала в ответе
- [ ] `GET /channels/{{ channel_id }}` → конкретный канал

### 2.3 Дубликат
- [ ] `POST /channels` с тем же `telegramId` → `409` или `400` (уникальность)

### 2.4 Удаление
- [ ] `DELETE /channels/{{ channel_id }}` → `200`
- [ ] Пересоздай канал (нужен для конкурсов)

---

## Блок 3 — Конкурс RANDOM, полный цикл

### 3.1 Создание
- [ ] `POST /contest` (multipart/form-data):
  - `name`: Рандом конкурс
  - `winnerStrategy`: random
  - `prizePlaces`: 1
  - `startDate`: через 2 минуты
  - `endDate`: через 60 минут
  - `publishChannelIds`: [-1001234567890]
  
  → `201`. Сохрани `id` как `contest_id`

### 3.2 Проверка статуса pending
- [ ] `GET /contest/{{ contest_id }}` → `status: "pending"`

### 3.3 Негативные кейсы в статусе pending
- [ ] `POST /contest/{{ contest_id }}/participate` с любым `telegramId` → `400 Конкурс ещё не начался`
- [ ] `PATCH /contest/{{ contest_id }}/complete` → `400 Нельзя завершить конкурс до его старта`

### 3.4 Активация
- [ ] Подожди 2 минуты (или обнови `startDate` на прошедшее)
- [ ] `GET /contest/{{ contest_id }}` → `status: "active"`

### 3.5 Участие
- [ ] Участие пользователя 1:
  ```json
  { "telegramId": "111111111", "groupId": "-1001234567890", "username": "user1" }
  ```
  → `200`, объект participation
- [ ] Повторное участие того же пользователя → `200`, тот же объект (дубликат не создаётся)
- [ ] Участие пользователя 2:
  ```json
  { "telegramId": "222222222", "groupId": "-1001234567890", "username": "user2" }
  ```
  → `200`
- [ ] Участие пользователя 3:
  ```json
  { "telegramId": "333333333", "groupId": "-1001234567890" }
  ```
  → `200`

### 3.6 Ограничения в статусе active
- [ ] `PATCH /contest/{{ contest_id }}` с `startDate` → `400 Нельзя изменить дату начала активного конкурса`
- [ ] `PATCH /contest/{{ contest_id }}` с `description: Новое описание` → `200` (разрешено)
- [ ] `DELETE /contest/{{ contest_id }}` → `400 Невозможно удалить активный конкурс`

### 3.7 Завершение
- [ ] `PATCH /contest/{{ contest_id }}/complete` → `200`, `status: "completed"`, поле `winners` содержит одного случайного из трёх участников
- [ ] `PATCH /contest/{{ contest_id }}/complete` повторно → `400 Конкурс уже завершён`

### 3.8 После завершения
- [ ] `POST /contest/{{ contest_id }}/participate` с новым `telegramId` → `200` возвращает массив победителей (не регистрирует нового участника)
- [ ] `DELETE /contest/{{ contest_id }}` → `200`

---

## Блок 4 — Конкурс MANUAL, назначение победителей

### 4.1 Создание
- [ ] `POST /contest` (multipart/form-data):
  - `winnerStrategy`: manual
  - `prizePlaces`: 2
  - `startDate`: через 1 минуту
  - `endDate`: через 60 минут
  
  → `201`. Сохрани `id` как `contest_id`

### 4.2 Назначение победителей до старта
- [ ] `PATCH /contest/{{ contest_id }}` с `winnerStrategy: manual` + `winners: [111111111]` → `400 Нельзя назначить победителей до старта конкурса`

### 4.3 Активация
- [ ] Подожди активации → `GET /contest/{{ contest_id }}` → `status: "active"`

### 4.4 Участники
- [ ] Добавь минимум 3 участников:
  - `telegramId: 111111111`
  - `telegramId: 222222222`
  - `telegramId: 333333333`

### 4.5 Назначение победителей (корректное)
- [ ] `PATCH /contest/{{ contest_id }}` (multipart):
  - `winnerStrategy`: manual
  - `winners`: [111111111, 222222222]
  - `prizePlaces`: 2
  
  → `200`
- [ ] `GET /contest/{{ contest_id }}` → в `winners` присутствуют `111111111` и `222222222`

### 4.6 Победители при стратегии non-manual (негативный кейс)
- [ ] `PATCH /contest/{{ contest_id }}` с `winnerStrategy: random` + `winners: [111111111]` → `400 Нельзя назначить победителей вручную при стратегии, отличной от manual`

### 4.7 Очистка победителей
- [ ] `PATCH /contest/{{ contest_id }}` с `winners: []` → `200`, победители удалены
- [ ] Переназначь: `winners: [111111111, 222222222]`

### 4.8 Завершение
- [ ] `PATCH /contest/{{ contest_id }}/complete` → `200`, победители **именно** `111111111` и `222222222` (не случайные)

### 4.9 Проверка после завершения
- [ ] `POST /contest/{{ contest_id }}/participate` → `200` возвращает назначенных победителей

---

## Блок 5 — Конкурс с обязательными каналами

### 5.1 Создание
- [ ] `POST /contest` с `requiredChannelIds: [-1009999999999]` (id из блока 2.1)
- [ ] Жди `status: "active"`

### 5.2 Участие без подписки
- [ ] `POST /contest/{{ contest_id }}/participate` с `telegramId` пользователя не из канала → `403 Необходимо подписаться на обязательные каналы: @req_channel`

### 5.3 Участие с подпиской
- [ ] `POST /contest/{{ contest_id }}/participate` с реальным `telegramId` подписчика → `200`

---

## Блок 6 — Конкурс CANCELLED

### 6.1 Отмена
- [ ] Создай конкурс → `status: pending`
- [ ] `PATCH /contest/{{ contest_id }}/cancel` → `200`, `status: "cancelled"`

### 6.2 Действия на отменённом
- [ ] Участие → `404 Конкурс не найден`
- [ ] `PATCH /contest/{{ contest_id }}/complete` → `400`
- [ ] `DELETE /contest/{{ contest_id }}` → `200`

---

## Блок 7 — Валидация создания конкурса

| Кейс | Ожидаемый ответ |
|------|----------------|
| `startDate` в прошлом | `400` |
| `endDate` < `startDate` | `400` |
| `endDate` = `startDate` | `400` |
| Без поля `name` | `400` |
| `prizePlaces: 0` | `400` |
| `winnerStrategy: unknown` | `400` |
| `name` длиннее 255 символов | `400` |

- [ ] `startDate` в прошлом → `400`
- [ ] `endDate` раньше `startDate` → `400`
- [ ] `endDate` равен `startDate` → `400`
- [ ] Без `name` → `400`
- [ ] `prizePlaces: 0` → `400`
- [ ] `winnerStrategy: invalid` → `400`
- [ ] `name` > 255 символов → `400`

---

## Блок 8 — Список и фильтрация конкурсов

### 8.1 Фильтры по статусу и стратегии
- [ ] `GET /contest?status=active` → только активные
- [ ] `GET /contest?status=completed` → только завершённые
- [ ] `GET /contest?status=pending` → только ожидающие
- [ ] `GET /contest?winnerStrategy=manual` → только manual

### 8.2 Поиск и сортировка
- [ ] `GET /contest?search=Рандом` → конкурсы с совпадением в имени
- [ ] `GET /contest?sortBy=endDate&sortOrder=ASC` → сортировка по дате окончания
- [ ] `GET /contest?sortBy=name&sortOrder=DESC` → сортировка по имени

### 8.3 Пагинация
- [ ] `GET /contest?page=1&limit=2` → первые 2 записи, в ответе `total`, `page`, `limit`
- [ ] `GET /contest?page=2&limit=2` → следующие 2 записи

### 8.4 Краткая инфо
- [ ] `GET /contest/short-info?status=active` → сокращённый формат

---

## Блок 9 — Users

### 9.1 Администраторы
- [ ] `POST /users` → создать нового администратора:
  ```json
  { "login": "test_admin", "password": "TestPass123" }
  ```
  → `201`
- [ ] `POST /users` с паролем без цифр → `400`
- [ ] `POST /users` с паролем < 8 символов → `400`
- [ ] `GET /users/admin/{{ user_id }}` → данные администратора

### 9.2 Telegram-пользователи
- [ ] `GET /users` → список (появляются после участия в конкурсах)
- [ ] `GET /users?page=1&limit=5` → пагинация
- [ ] `GET /users/user/{{ user_id }}` → конкретный пользователь
- [ ] `GET /users/{{ user_id }}/details` → детали с историей участий

### 9.3 Рассылка
- [ ] `POST /users/broadcast` — всем:
  ```
  type: all
  text: Тест рассылки
  ```
  → `200 { jobId, enqueuedCount }`
- [ ] `POST /users/broadcast` — конкретному пользователю:
  ```
  type: user
  userId: 1
  text: Личное сообщение
  ```
  → `200`
- [ ] `POST /users/broadcast` — группе:
  ```
  type: group
  groupId: -1001234567890
  text: Сообщение в группу
  ```
  → `200`
- [ ] `POST /users/broadcast` с кнопкой:
  ```
  type: all
  text: Сообщение с кнопкой
  buttonText: Перейти
  buttonUrl: https://t.me/your_bot
  ```
  → `200`

---

## Итоговый чеклист (быстрый прогон)

- [ ] Health — все сервисы `ok`
- [ ] Login → сессия работает
- [ ] Logout → сессия очищена
- [ ] Создать канал
- [ ] Создать конкурс RANDOM
- [ ] Участие до старта → `400`
- [ ] Завершить до старта → `400`
- [ ] Конкурс стал `active`
- [ ] Участие 3 пользователей
- [ ] Повторное участие идемпотентно
- [ ] Изменить `startDate` у активного → `400`
- [ ] Удалить активный → `400`
- [ ] Завершить → случайный победитель из трёх
- [ ] Завершить повторно → `400`
- [ ] Участие в завершённом → массив победителей
- [ ] Создать конкурс MANUAL с 2 местами
- [ ] Назначить победителей до старта → `400`
- [ ] Назначить победителей после старта → `200`
- [ ] Завершить → победители те самые, не случайные
- [ ] Конкурс с обязательным каналом → `403` без подписки
- [ ] Отменить конкурс → участие `404`
- [ ] Удалить завершённый/отменённый → `200`
- [ ] Фильтры списка конкурсов работают
- [ ] Пагинация работает
- [ ] Создать администратора
- [ ] Рассылка `type: all` → задача поставлена в очередь
