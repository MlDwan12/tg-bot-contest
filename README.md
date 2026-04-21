## Project setup

```bash
$ yarn install
```

## Compile and run the project

```bash
# development
$ yarn run start

# watch mode
$ yarn run start:dev

# production mode
$ yarn run start:prod
```

## Run tests

```bash
# unit tests
$ yarn run test

# e2e tests
$ yarn run test:e2e

# test coverage
$ yarn run test:cov
```

src/modules/bot/
├─ bot.module.ts # регистрирует Telegraf
├─ bot.update.ts # ловит /start и callback
├─ bot.service.ts # логика рассылок, отправка сообщений
└─ bot.constants.ts # константы, admin id, лимиты

ТЕСТЫ
Покрытие ContestsService.createContest

1. Успешные сценарии
   ✔ Создание конкурса без изображения
   ✔ Создание конкурса с изображением
   ✔ Подставляется дефолтный buttonText, если не передан
   ✔ Создание при пустом publishChannelIds
   ✔ Создание при пустом requiredChannelIds
   ✔ Сохраняется порядок каналов (важно для UX и логики публикаций)
   ✔ Корректно формируется payload публикаций (текст, кнопка, URL)
2. Валидация входных данных
   ✔ Ошибка, если startDate >= endDate
   ✔ Ошибка, если создатель (админ) не найден
3. Работа с каналами
   ✔ Ошибка, если publish-каналы не найдены
   ✔ Ошибка, если required-каналы не найдены
   ✔ Проверка, что бот:
   ❌ не найден в канале → ошибка
   ❌ не админ → ошибка
   ❌ не может постить → ошибка
   ❌ не может редактировать → ошибка
   ✔ Агрегация ошибок прав (несколько каналов → одно сообщение)
4. Интеграция с Telegram
   ✔ Проверка прав бота вызывается
   ✔ Проверка не вызывается, если нет publish-каналов
5. Работа с репозиториями
   ✔ Создание конкурса (create)
   ✔ Привязка publish-каналов
   ✔ Привязка required-каналов
   ✔ Создание публикаций
   ✔ Удаление старых pending публикаций
6. Ошибки (critical path)

Ты проверил, что сервис не глотает ошибки, а пробрасывает их:

✔ Ошибка при create
✔ Ошибка при setPublishChannels
✔ Ошибка при setRequiredChannels
✔ Ошибка при createPublications
✔ Ошибка при scheduleContest
✔ Ошибка при финальном findByIdWithRelations 7. Очереди (jobs)
✔ Проверка, что scheduleContest вызывается
✔ Проверка, что ошибка из него пробрасывается
