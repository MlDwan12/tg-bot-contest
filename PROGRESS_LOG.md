# Журнал прогресса

> Живой журнал перестройки. Заполняется ПОСЛЕ каждого шага, чтобы следующая сессия продолжила без потерь.
> План — [EXECUTION_PLAN.md](./EXECUTION_PLAN.md). Анализ — [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md). Структура — [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md).

---

## 📍 СЕЙЧАС (читать первым при старте сессии)
- **Ветка:** `refactor` (= чистая точка от прода).
- **Статус:** **Фазы 0, 2, 3, 4, 5, 7, 8 ЗАКРЫТЫ.** **18 инт-тестов (10 сьютов) + 3 юнита фильтра + 2 юнита паролей — ВСЕ зелёные, `yarn build` чистый.** Весь `src/shared/` схлопнут в единый `src/common/` (constants/response/enums/validators + прежние decorators/dtos/filters/helpers/interceptors); доменные `types` разложены по модулям; мёртвый roles-decorator удалён. Сеть безопасности (3 горячих пути); F1-гонка закрыта воротами `updateStatusIfNotCompleted` (+ сторож); пустой конкурс штатно завершается; **RANDOM provably-fair** (crypto-seed + детерминированный shuffle, `Math.random` удалён, пересчёт из seed воспроизводит победителей); **MANUAL-аудит** (кто/кого/когда назначил, история не затирается) — обе стратегии в единой `contest_winner_audit`.
- **Фаза 1 (initData) — ОТЛОЖЕНА решением пользователя (2026-07-09): «сейчас ни на что не влияет».** Нюанс на будущее: заблокирован только БОЕВОЙ щелчок роута (старый фронт без `initData` сломается при переключении). Сам валидатор HMAC + guard + тесты можно написать НЕЗАВИСИМО от фронта (в тесте генерим валидный `initData` тест-токеном). Возвращаться, когда будет актуально / появится координация с фронтендером.
- **⏭️ ТОЧНЫЙ СЛЕДУЮЩИЙ ШАГ (продолжить отсюда): Фаза 6 В ПРОЦЕССЕ — сеть (bootstrap-smoke) ГОТОВА, дальше резать первый цикл.** Сеть: `bootstrap.int-spec.ts` реально поднимает `AppModule.compile()` (сторож против битых `forwardRef`). Прогон: `yarn test:int` = core 18/18 + boot 1/1 (изолированы в разные процессы — иначе BullMQ-воркеры bootstrap флакуют F1-гонку). **✅ Разорваны users↔auth (шаг 2), contests↔contests-jobs (шаг 3), прямой bot↔channels (шаг 4, мёртвый импорт).** Все: core 18/18 + boot 1/1. **Остался 1 (толстый):** bot↔contests — хаб `TelegramService`(bot) ↔ `ContestPublicationService`(contests). После него схлопнутся и остаточные 3-звенные пути (channels→bot держится за счёт него). Приёмы разрывов: (а) избыточный @Global-импорт; (б) перенос producer в свой домен; (в) удаление мёртвого импорта. Правило шага: после разрыва И core 18/18, И boot 1/1. **Не закоммичен:** разрез bot↔channels (шаг 4) — закоммитить (шаги 1–3 в origin).
- ~~выбрать между Фазой 6 и лёгкими 9/10/11~~ Фаза 8 закрыта (консолидация `shared/`→`common/`). **NB:** подшаги 8.2 (единые имена `kebab-case.<type>.ts`) и 8.3 (убрать barrels в кросс-DI) НЕ делали — опциональны, можно вернуться. Варианты дальше: **(a) Фаза 6 — разрыв циклов (🟡)**, но ПЕРВЫМ шагом нужен bootstrap-smoke (`Test.createTestingModule().compile()`), т.к. наш инт-харнесс собирает сервисы вручную, ОБХОДЯ Nest DI — разрыв цикла может пройти 18 тестов и уронить реальный старт; **(b) Фаза 9** — схлопнуть CQRS-репозитории (🟢); **(c) Фаза 10** — дробление толстых сервисов, `participate()` (🟢); **(d) Фаза 11** — эффективность F2/F4 (🟢, низкий приоритет).
  - **Метод структурных фаз (усвоено на Фазе 8):** поведение не меняем → характеризационные тесты не пишем, сеть = `yarn build` + существующие 18 инт-тестов; микрошагами от меньшего радиуса импортов к большему. При переносах файлов: `grep "shared/"` (без префикса!) по ОБОИМ деревьям `src/ test/` — ловить относительные И абсолютные пути; `yarn build` компилит только `src/`, поэтому тесты проверять отдельно.
  - **Опция (Sentry trace):** авто-инструментирование v10 (`instrument.ts` в самом верху main) НЕ включено — упирается в загрузку env ДО `Sentry.init` (иначе DSN=undefined). Отдельный аккуратный шаг с переносом dotenv, если понадобится трейсинг.
  - Прочие остатки-кандидаты (🟢): типизировать `findByIdWithRelations: Promise<any>`; MANUAL-очистка победителей в аудит (`contests.service.ts:294/343`); helmet НЕ трогать (Bull Board CSP).
- **Как гонять тесты:** `yarn test:db:up` (если контейнеры погашены) → `yarn test:int`. Погасить: `yarn test:db:down`.
- **Харнесс:** testcontainers НЕ используем (segfault на Node 22) → `docker-compose.test.yml` (PG 5433 / Redis 6380, проект `tg-bot-test`), конфиг `.env.test` (база `tg_bot_test`).
- **Метод тестов:** «ручная сборка» — реальный репозиторий/сервис (`build-services.ts`) + реальная тест-БД + фейки внешнего мира (Telegram/очереди/logger `as any`), без bootstrap Nest/Telegraf. Фикстуры — `fixtures.ts`. Verbose + `console.log('[наблюдение] …')` с реальными данными Postgres.
- **Правило работы с тестами:** перед каждым тестом проговорить пользователю (1) бизнес-правило, (2) 🟢 закрепляем / 🔴 мишень (по `ARCHITECTURE_REVIEW.md`). НЕ цементировать баги. Красные подчёркивания в редакторе (`describe`/ESLint `as any`) — косметика, `ts-jest` их игнорирует.
- **Рабочий режим (важно):** пользователь **сам** запускает все важные команды (тесты/установки/git) — я только даю команду и объясняю. Объяснять подробно, по-новичковски.
- **Блокеры:** Фаза 1 (initData) требует координации с фронтендером (Mini App шлёт `initData`). Старые юнит-тесты (`yarn test`) — 43 красных, не «сеть безопасности». testcontainers-пакеты позже удалить.

---

## 🔄 Старт новой сессии (для пользователя)
Чтобы продолжить в той же манере, в новой сессии напиши примерно так:

> «Продолжаем рефакторинг телеграм-бота. Прочитай `PROGRESS_LOG.md` (блок «СЕЙЧАС») и продолжай с точного следующего шага в том же режиме: я сам запускаю команды, ты объясняешь подробно и по-новичковски, тесты характеризационные с наблюдениями, перед каждым — правило и 🟢/🔴.»

Перед прогоном тестов подними тестовый стек: `yarn test:db:up` (и `yarn test:db:migrate`, если контейнеры пересоздавались). Ассистент сам подхватит контекст из `PROGRESS_LOG.md` / `ARCHITECTURE_REVIEW.md` / `PROJECT_STRUCTURE.md` / `EXECUTION_PLAN.md` и памяти.

## Как пользоваться журналом
После КАЖДОГО шага добавляй запись в раздел «Хронология» по шаблону:

```
### [YYYY-MM-DD] Фаза X.Y — <краткое название>
- **Сделано:** что именно изменено (файлы/сущности).
- **Коммит(ы):** <hash + сообщение>.
- **Тесты:** какие добавлены/зелёные; что проверено вручную.
- **Гочи/заметки:** на что напоролись, что важно помнить.
- **Откат:** как откатить, если понадобится.
- **Следующий шаг:** обновить также блок «СЕЙЧАС» вверху.
```

Правило: обновлять блок «СЕЙЧАС» на каждом шаге — он единственный источник «где мы».

---

## Чек-лист фаз (галочка = Done по критерию из плана)
- [x] Фаза 0 — тесты горячих путей + харнесс ✅ (3 пути + мишень F1)
- [ ] Фаза 1 — initData-аутентификация 🔴🔴
- [x] Фаза 2 — F1 (гонка завершения) ✅ (CAS-ворота в completeContest + сторож)
- [x] Фаза 3 — аудит (MANUAL-лог + crypto-rng + seed) ✅ (provably-fair RANDOM + MANUAL who/when)
- [x] Фаза 4 — Sentry ✅ (5xx/не-HTTP → Sentry в AllExceptionsFilter, 4xx нет)
- [x] Фаза 5 — bcrypt ✅ (консолидация на bcryptjs, нативный bcrypt удалён, хеши кросс-совместимы)
- [ ] Фаза 6 — infra/telegram + разрыв циклов 🟡
- [x] Фаза 7 — быстрые победы ✅ (мёртвые deps, jsonwebtoken/CORS в deps/env)
- [x] Фаза 8 — консолидация структуры ✅ (весь `shared/` схлопнут в единый `common/`; contests/commons убрана; мёртвый roles-decorator удалён; доменные types → по модулям; 8.2 имена / 8.3 barrels НЕ делали)
- [ ] Фаза 9 — схлопнуть CQRS-репозитории 🟢
- [ ] Фаза 10 — дробление толстых сервисов 🟢
- [ ] Фаза 11 — эффективность F2/F4 🟢
- [ ] Фаза 12 — опц. терминальное состояние F5 🟢

---

## Хронология

### [2026-07-08] Фаза −1 — Анализ и решения
- **Сделано:** полный архитектурный разбор Q1–Q6; собраны `ARCHITECTURE_REVIEW.md`, `PROJECT_STRUCTURE.md`, `EXECUTION_PLAN.md`, этот журнал.
- **Ключевые решения:** эволюция (не rewrite); модульный монолит + прагматичный слоёный подход; `common` + `infra/`; один репозиторий на агрегат; порт только на Telegram.
- **Код:** не трогали.

### [2026-07-08] Фаза 0.1a — Смоук-тест харнесса ✅
- **Сделано:** пробовали testcontainers → нативный **segfault на Node 22** (падает `require('@testcontainers/postgresql')`). Пивот на отдельный `docker-compose.test.yml` (PG 5433 / Redis 6380, эфемерные, проект `tg-bot-test`). Добавлены: `jest-integration.json`, `test/integration/env.ts` (загрузка `.env.test` + защита «имя базы обязано содержать test»), `test/integration/smoke.int-spec.ts`, скрипты `test:int` / `test:db:up` / `test:db:down`.
- **Тесты:** `yarn test:int` → `1 passed` (подключение к `tg_bot_test`, `SELECT 1`).
- **Гочи:** `yarn start test:int` ≠ `yarn test:int` (первое поднимает приложение). Orphan-warning убрали через `name: tg-bot-test` в тестовом compose.
- **Следующий шаг:** 0.1b — миграции в тест-базу.

### [2026-07-08] Фаза 0.1b — Миграции в тест-базу ✅
- **Сделано (файлы):** `test/integration/test-data-source.ts` (TS-globs, тест-база, защита), скрипт `test:db:migrate`, `test/integration/schema.int-spec.ts` (проверка таблиц contests/contest_participants/users/channels).
- **Тесты:** миграции применились, `schema.int-spec` зелёный.

### [2026-07-08] Фаза 0.1c — Очистка состояния + Redis ✅
- **Сделано:** `test/integration/harness.ts` (`initTestDb` / `truncateAll` / `closeTestDb` / `testRedis`), `harness.int-spec.ts` (проверка очистки между тестами + redis ping).
- **Тесты:** `yarn test:int` → 8/8, 3 сьюта. **Фаза 0.1 полностью закрыта.**

### [2026-07-08] Фаза 0.2 — Характеризационные тесты (в процессе)
- **Сделано (файлы):** `test/integration/fixtures.ts` (createUser/createContest), `participation-unique.int-spec.ts` — правило «один юзер = одно участие в конкурсе» (🟢), проверяет реальный `ContestParticipationWriteRepository` против уникального индекса (23505).
- **Сделано:** `participation-unique.int-spec.ts` — 11/11 зелёных. Наблюдение подтвердило `code=23505` на верхнем уровне (продовый перехват дублей работает).
- **Добавлено:** `build-services.ts` (сборка реальных репо из тест-БД), `participate-idempotency.int-spec.ts` — правило «повтор → то же участие, без 2-й строки» (🟢). Впервые собран реальный `ContestsParticipateService` вручную (фейки только на внешний мир).
- **Тесты:** `yarn test:int` → **12/12 зелёных, 5 сьютов.** Наблюдение идемпотентности: `first.id=second.id=1`, строк в БД=1.
- **⏸️ Сессия приостановлена здесь.** Начата правка `build-services.ts` (добавить winner-репо + `buildWinnerService`) — **ОТКЛОНЕНА, не записана.** Продолжить строго с блока «СЕЙЧАС».
- **Дальше:** winner-draw (🟢 розыгрыш + reuse-guard) → 🔴 тест-мишень F1 (гонка при одновременном завершении).

### [2026-07-09] Фаза 0.2 — Розыгрыш победителей (🟢 закрепление)
- **Сделано (файлы):** `build-services.ts` — добавлены `winnerRead`/`winnerWrite` (по одному аргументу `ds.getRepository(ContestWinner)`) и `buildWinnerService(ds)` = `new ContestWinnerService(winnerRead, winnerWrite, participationRead, participationWrite)`. `fixtures.ts` — фикстура `addParticipant(ds, contestId)` (создаёт user + строку `contest_participants`, возвращает `{ user, participation }`). Новый спек `winner-draw.int-spec.ts`.
- **Тесты:** `yarn test:int` → **14/14 зелёных, 6 сьютов.** Дёргаем реальный `ContestWinnerService.resolveAndSaveWinners()`.
  - Правило 1 (🟢): RANDOM выбирает победителей ИЗ участников, число = призовым местам. Наблюдение: `участников=4, места=2, победители=[2,3] места=[1,2]`.
  - Правило 2 (🟢): reuse-guard — повторный запуск НЕ перевыбирает. Наблюдение: 10 участников на 1 место, `1-й=6, 2-й=6` (совпадение при перерозыгрыше было бы 1/10 → тест поймал бы регресс).
- **Гочи/заметки:** `resolveAndSaveWinners` короткозамыкает через `existingWinners.length>0` → возвращается рано, только синкает флаги. Розыгрыш читает участников `findManyByContestId` c `relations:{user:true}` — `participant.user` заполнен. Winner-репо в проде — `@InjectRepository(ContestWinner)`, т.е. в конструкторе ОДИН аргумент (без `DataSource`).
- **Откат:** удалить `winner-draw.int-spec.ts`; откатить добавления в `build-services.ts`/`fixtures.ts`.
- **Следующий шаг:** 🔴 тест-мишень F1 (гонка одновременного завершения) — см. блок «СЕЙЧАС».

### [2026-07-09] Фаза 0.2 — 🔴 Мишень F1 (гонка завершения) + ЗАКРЫТИЕ фазы
- **Сделано (файлы):** `winner-draw-race.int-spec.ts` — мишень F1. Собран НАСТОЯЩИЙ `ContestLifecycleService` (реальные `contestRead/contestWrite/participationRead` + реальный `ContestWinnerService`; фейки: queue/jobs/publication/logger/telegram). Дёргаем реальный `completeContest`.
- **Метод (важно на будущее):** наивный `Promise.all` гонку НЕ воспроизвёл (ложнозелёный: draws=1 — планировщик успевал завершить один вызов до чтения другого). Решение — **барьер-шпион** на `winnerRead.findByContestId`: подменяем ТАЙМИНГ чтения (call-through данных), держим оба завершения, пока оба не прочитают «победителей нет», потом отпускаем к записи. Барьер с таймаут-подстраховкой (500мс) → после фикса второй вызов отсечётся до розыгрыша и барьер не зависнет.
- **Высота теста (важно):** мишень бьёт в `completeContest` (там будет фикс), НЕ в `resolveAndSaveWinners` напрямую — иначе после фикса не позеленеет.
- **Тесты:** `yarn test:int` → **14 зелёных + 1 намеренно-красная (мишень F1)**, 7 сьютов, exit 1. Красная по ПРАВИЛЬНОЙ причине.
- **Наблюдение (сильнее ожидаемого):** `розыгрышей(replace)=2` (гонка детерминирована), наборы победителей `[[6],[2]]` — два РАЗНЫХ (перевыбор), `итоговые в БД=[2,6]` — ⚠️ осели ОБЕ строки при `prizePlaces=1` → нарушен инвариант «победителей = призовым местам» (двойной DELETE не удалил чужую uncommitted строку). Оба вызова `fulfilled`.
- **Гочи/заметки:** конструктор `ContestLifecycleService` — 10 позиционных аргументов (порядок: contestRead, contestWrite, participationRead, queue, jobs, winnerService, publication, logger, dataSource, telegram). `completeContest` в этом пути зовёт только findByIdWithRelations/resolveAndSaveWinners/contestWrite.update/publication.syncPublishedPosts — остальное безопасно фейкать.
- **Откат:** удалить `winner-draw-race.int-spec.ts` (вернёт `yarn test:int` к exit 0).
- **Следующий шаг:** Фаза 2 — фикс F1 (атомарные ворота в `completeContest`). Критерий: мишень зеленеет (draws=1 И победителей=prizePlaces). См. блок «СЕЙЧАС».

**✅ Фаза 0 закрыта.** Сеть безопасности стоит: 3 горячих пути закреплены (🟢), гонка F1 поймана живой мишенью (🔴). Можно безопасно резать швы.

### [2026-07-09] Фаза 2 — ФИКС F1 (атомарные ворота) + правило пустого конкурса
- **Сделано (продовый код):** `contest-lifecycle.service.ts` `completeContest` — добавлены **CAS-ворота** `updateStatusIfNotCompleted` (ACTIVE→COMPLETED одним атомарным UPDATE) ПЕРЕД розыгрышем: гонку выигрывает один, он и разыгрывает; проигравший получает `claimed=false` → throw «Конкурс уже завершён», без розыгрыша. Розыгрыш обёрнут в try/catch с **откатом ворот** (COMPLETED→прежний статус) на случай невалидного розыгрыша (MANUAL без победителей / участников < мест), чтобы конкурс не завис завершённым без победителей. Статус больше НЕ пишется во втором `update` (только `buttonText`).
- **Решение по флоу (с пользователем):** пустой конкурс (0 участников) завершается **успешно, 0 победителей** — как шедулер (`hasParticipants` из уже загруженных `contest.participants`, розыгрыш пропускается). Раньше completeContest тут кидал 400 и застревал в ACTIVE (расхождение с автозавершением). «Нет победителей» = валидный исход.
- **Решение по фиксу (с пользователем):** выбраны CAS-ворота (не advisory lock) — легче, уже используются в шедулере, проще тестируются. Прикрывает и двойной клик, и частично кросс-путь manual↔scheduler (шедулер, увидев COMPLETED, выходит). Полный кросс-путь (шедулер разыгрывает ДО флипа) — отдельный шаг, НЕ закрыт этим фиксом.
- **Тесты (файлы):** `winner-draw-race.int-spec.ts` (мишень F1) переведён red→green — теперь регрессионный сторож (ассерты: `розыгрышей(replace)===1` И `победителей===prizePlaces`). Новый `complete-empty.int-spec.ts` (🟢): пустой конкурс → COMPLETED, 0 победителей, `replace` не вызван. Харнесс: в `build-services.ts` добавлен `buildLifecycleService(ds)` (реальный ContestLifecycleService + фейки внешнего мира), оба lifecycle-теста переведены на него (убрано дублирование 10 аргументов конструктора).
- **Тесты (прогон):** `yarn test:int` → **16/16 зелёных, 8 сьютов, exit 0.** Наблюдения: F1 `розыгрышей=1, исходы=["fulfilled","rejected"]`; пустой `статус=completed, победителей=0, розыгрышей=0`.
- **Метод (важно на будущее):** гонку в тесте форсируем детерминированно барьером-шпионом на `winnerRead.findByContestId` (пиннит worst-case порядок «оба прочитали пусто до записи»); наивный Promise.all давал ложнозелёный. Барьер с таймаут-подстраховкой (500мс) — после фикса проигравший до чтения не доходит, барьер не виснет.
- **Откат:** revert правки `completeContest` (вернётся двойной розыгрыш; сторож снова покраснеет). Тесты можно оставить.
- **Следующий шаг:** Фаза 3 — аудит (crypto-rng + след розыгрыша + MANUAL-лог). См. блок «СЕЙЧАС».

### [2026-07-09] Фаза 3 (RANDOM) — provably-fair розыгрыш + crypto-rng + след
- **Решения (с пользователем):** (1) модель следа = **provably-fair** (seed + пересчёт), не просто аудит-лог; (2) таблица **единая под RANDOM и MANUAL** (`contest_winner_audit`), спроектирована сразу под оба (nullable стратегие-специфичные поля) → без миграции-ломки потом; (3) в этой сессии — только RANDOM, MANUAL следующим шагом. Причина MANUAL-важности: там инсайдерский риск оператора выше, нужен журнал «кто/когда/кого».
- **Сделано (прод):** новая утилита `services/seeded-draw.util.ts` — `generateSeed()` (crypto.randomBytes 32B hex), детерминированный `seededShuffle` (Fisher-Yates на HMAC-SHA256(seed, counter) + rejection sampling против modulo-смещения), версия `DRAW_ALGORITHM='fisher-yates-hmac-sha256-v1'`. `contest-winner.service.ts`: `resolveAutomaticWinners` теперь сортирует пул канонически (по userId), генерит seed, seeded-shuffle, и пишет неизменяемый след (fail-closed). **`Math.random`/`shuffleArray` удалены.** +зависимость `ContestWinnerAuditWriteRepository` в конструкторе.
- **Схема:** entity `ContestWinnerAudit` (`contest_winner_audit`, без FK — след переживает удаление конкурса), write-репо `record()` (только INSERT), регистрация в `contests.module.ts` (forFeature + provider), миграция `1783900000000-AddContestWinnerAudit.ts` (таблица + индекс по contestId). Экспорт в entities/repositories баррелях.
- **Тесты:** `build-services.ts` — в `buildContestRepos` добавлен `winnerAudit`, протянут в `buildWinnerService`/`buildLifecycleService` (5-й арг конструктора). Новый `winner-draw-audit.int-spec.ts` (🟢): розыгрыш пишет seed+пул, независимый `seededShuffle(пул, seed)` воспроизводит записанных победителей один-в-один. `yarn test:int` → **17/17 зелёных, 9 сьютов.** Наблюдение: `пересчёт==победители(след)==в БД=[5,2]`.
- **Гочи/заметки:** таблицу нужно применить в тест-БД (`yarn test:db:migrate`) — иначе ВСЕ draw-path тесты падают (розыгрыш пишет след). `truncateAll` динамический — новую таблицу чистит сам. Fail-closed: если запись следа упадёт, розыгрыш откатится (в `completeContest` — через try/catch отката ворот).
- **Откат:** revert `resolveAutomaticWinners` к shuffleArray/Math.random + убрать audit-зависимость; down-миграция дропает таблицу.
- **Следующий шаг:** Фаза 3 MANUAL — см. блок «СЕЙЧАС».

### [2026-07-09] Фаза 3 (MANUAL) — аудит назначения победителей (Q5.2)
- **Решения (с пользователем):** (1) MANUAL важен для репутации (инсайдерский риск оператора) → нужен журнал «кто/кого/когда», НЕ пересчёт; (2) при сбое записи аудита — **best-effort** (лог, не ломать назначение), т.к. `updateContest` не транзакционен и fail-closed дал бы частичное состояние.
- **Принцип «не сломать» (важно):** рабочий путь назначения `contestWriteRepo.replaceWinners` (`contests.service.ts:328`) — НЕ тронут (никакого реврайта/новой валидации). Мёртвый `replaceManualWinners` — тоже не тронут. Аудит добавлен ЧИСТО СВЕРХУ.
- **Сделано (прод):** новый метод `ContestWinnerService.recordManualAssignment(contestId, winnerUserIds, prizePlaces, actorUserId?)` — только пишет след (`strategy='manual'`, `assignedByUserId`, RANDOM-поля null). В `updateContest` после существующего `replaceWinners` — best-effort вызов в try/catch (падение → `logger.error`, назначение не рушится). Проброс актора: контроллер `@UserId()` (готовый декоратор, `req.user.id ?? sub`) → `updateContest(…, actorUserId)` → метод. +зависимость `ContestWinnerService` в `ContestsService` (цикла нет, оба в одном модуле).
- **Тесты:** новый `winner-manual-audit.int-spec.ts` (🟢): назначение пишет след с `assignedByUserId`+победителями, RANDOM-поля null; повторное назначение → 2 записи (история не затирается). `yarn build` чистый, `yarn test:int` → **18/18 зелёных, 10 сьютов.** Наблюдение: `assignedBy=1, победители=[3,4]`; после повтора `записей=2, набор=[3,5]`.
- **Гочи/заметки:** ESLint `no-unsafe-*` флот в `contests.service.ts` — пред-существующий долг (`findByIdWithRelations: Promise<any>`), не от этих правок, сборку не валит (кандидат в Фазу 7). Тест бьёт в `recordManualAssignment` (лёгкая высота); проброс актора контроллер→сервис проверен `yarn build` (типы). MANUAL-очистка победителей (пустой список, `:294/:343`) следа НЕ пишет — осознанно (не «назначение»); можно добавить позже.
- **Откат:** убрать best-effort блок из `updateContest` + метод `recordManualAssignment` + зависимость. Таблица общая — остаётся.
- **Следующий шаг:** Фаза 4 (Sentry) или Фаза 7 (быстрые победы) — см. блок «СЕЙЧАС».

**✅ Фаза 3 закрыта полностью** — доказуемость обеих стратегий: RANDOM provably-fair (пересчёт), MANUAL подотчётность (кто/кого/когда).

### [2026-07-09] Фаза 7 — Быстрые победы (низкорисковая гигиена)
- **7.1 Мёртвые зависимости удалены** из `package.json`: `mongoose`, `@nestjs/mongoose`, `@sentry/tracing`, `@testcontainers/postgresql`, `@testcontainers/redis`. Все подтверждённо не импортируются (grep пуст по src+test). `yarn install` пересобрал lock.
- **7.2 `.gitignore`:** `dist/`, `*.tar` уже покрыты, артефактов в git нет (`git ls-files` пуст) → пункт де-факто был выполнен; убран только дубликат строки `*.tar`.
- **7.3 Конфиг:** порт уже из env (`PORT ?? 3000`); **CORS вынесен в env** (`CORS_ORIGINS`, список через запятую) с фолбэком на прежний захардкоженный список — поведение не меняется без переменной; **`jsonwebtoken` (^9.0.3) добавлен явно в deps** + `@types/jsonwebtoken` (^9.0.10) в devDeps (импортировался в `main.ts:18`, но был транзитивным).
- **НЕ сделано осознанно:** helmet «до роутеров» — `app.use(helmet())` (`main.ts`) стоит ПОСЛЕ роутера Bull Board намеренно; перенос выше накрыл бы Bull Board строгим CSP и сломал бы его UI. Оставлено как есть.
- **Проверка:** `yarn install` (чисто, минус 4 пакета/плюс jsonwebtoken), `yarn build` чисто, `yarn test:int` → **18/18 зелёных** (харнесс на docker-compose, testcontainers не задет).
- **Откат:** вернуть удалённые строки в `package.json` + `yarn install`; вернуть захардкоженный CORS.
- **Следующий шаг:** Фаза 4 (Sentry) — см. блок «СЕЙЧАС».

### [2026-07-09] Фаза 4 — Sentry (перехват ошибок)
- **Дыра:** `AllExceptionsFilter` (единственный активный глобальный фильтр) логировал 5xx, но в Sentry НЕ слал. `SentryFilter` (ручной `captureException`) был закомментирован — и не мог сосуществовать: другой формат ответа (`{message}`) ломал бы единый конверт `{success,status,data}`.
- **Сделано (прод):** в `AllExceptionsFilter` добавлен `Sentry.captureException` для **5xx** и **необработанных не-HTTP**; **4xx НЕ шлём** (ожидаемый клиентский шум). Формат ответа не тронут. Удалён мёртвый `src/common/filters/sentry.filter.ts` + его импорт/закомментированная строка в `main.ts`.
- **НЕ тронуто осознанно:** `Sentry.init` (`main.ts`) оставлен ПОСЛЕ `NestFactory.create` — там `ConfigModule` уже загрузил `SENTRY_DSN` в env; перенос наверх (для v10 авто-инструментирования) сломал бы DSN. Трейсинг/instrument.ts — опция на потом.
- **Тест:** `src/common/filters/allExceptionsFilter.spec.ts` (юнит, `jest.mock('@sentry/node')`): 5xx→capture+конверт 500; 4xx→не capture; не-HTTP→capture. Bootstrap-уровень — вне интеграционного HTTP-харнесса, поэтому юнит. `yarn build` чист, `yarn test allExceptionsFilter` → **3/3**. (`@sentry/tracing`/`@testcontainers` — уже удалены в Фазе 7; здесь только `@sentry/node`.)
- **Откат:** убрать capture-вызовы из фильтра; вернуть `sentry.filter.ts` при желании.
- **Следующий шаг:** Фаза 5 (bcrypt) — см. блок «СЕЙЧАС».

### [2026-07-13] Фаза 6 (шаг 4) — разорван прямой цикл bot↔channels (мёртвый импорт)
- **Диагноз (асимметрия):** channels→bot РЕАЛЬНА (`channels.service` + `health.service` инъектят `TelegramService`). bot→channels — МЁРТВЫЙ импорт: в модуле bot единственная ссылка на channels — `import { ChannelsModule }` в `bot.module`; ничто в bot не инъектит `ChannelsService` (совпадения «channel» в bot.service — локальные методы `checkUserInChannels`/`isChannel`, не DI).
- **Сделано:** убран `import ChannelsModule` + `forwardRef(() => ChannelsModule)` из `bot.module`. Прямой 2-звенный цикл bot↔channels устранён.
- **⚠️ Оговорка (channels→bot ОСТАЛСЯ forwardRef):** channels→bot всё ещё в БОЛЬШЕМ цикле `bot→contests→channels→bot` (bot реально зависит от contests через `ContestPublicationService`; contests→channels; channels→bot). Полное освобождение channels — только после разрыва толстого bot↔contests. Этот шаг = чистка dead-import + минус одно ребро графа.
- **Проверка:** `yarn build` чист; `yarn test:int` → core **18/18** + boot **1/1**.
- **Откат:** вернуть импорт+forwardRef ChannelsModule в bot.module.
- **Осталось циклов:** толстый bot↔contests (хаб TelegramService ↔ ContestPublicationService) — финал, после него схлопнутся и остаточные 3-звенные пути.
- **Следующий шаг:** закоммитить; финальный разрез bot↔contests. См. блок «СЕЙЧАС».

### [2026-07-13] Фаза 6 (шаг 3) — разорван цикл contests↔contests-jobs (producer/consumer)
- **Диагноз (настоящий двусторонний цикл, НЕ избыточность):** contests→jobs: `contests.service`/`contest-lifecycle.service` инъектят `ContestJobsService` (ставят задачи). jobs→contests: процессоры (`Publish/Publication/Finish/Counters`) инъектят сервисы contests (`ContestLifecycleService`/`ContestPublicationService`) — выполняют работу. Классика producer/consumer.
- **Ключ:** `ContestJobsService` (producer) зависит ТОЛЬКО от 3 очередей BullMQ (`contest-scheduler/finish/maintenance`, реестр в `QueuesModule`, экспортит BullModule) и `CONTEST_READ_REPOSITORY` (провайдер самого ContestsModule). → его можно переселить в ContestsModule без jobs-специфики.
- **Сделано (с пользователем — регистрация + перенос файла):** `contest-jobs.service.ts` `jobs/services/`→`services/` (producer в своём домене), внутр. импорт `../../interfaces`→`../interfaces`, 4 импортёра на `./contest-jobs.service`, barrel `jobs/services/` удалён, добавлен в barrel `services/`. `ContestsModule`: +`ContestJobsService` в providers, убран импорт+forwardRef `ContestsJobsModule`. `ContestsJobsModule`: −`ContestJobsService` (providers/exports), `forwardRef(ContestsModule)`→обычный. Итог: зависимость односторонняя **jobs→contests** (потребители тянут сервисы), producer у себя.
- **Проверка:** `yarn build` чист; `yarn test:int` → core **18/18** + boot **1/1** (DI резолвит ContestJobsService в новом модуле: очереди из QueuesModule + локальный CONTEST_READ_REPOSITORY).
- **Откат:** вернуть файл в `jobs/services/`, регистрацию ContestJobsService в jobs, forwardRef с обеих сторон.
- **Осталось циклов:** bot↔channels, bot↔contests (толстый, хаб TelegramService — последним).
- **Следующий шаг:** закоммитить; следующий цикл bot↔channels. См. блок «СЕЙЧАС».

### [2026-07-13] Фаза 6 (шаг 2) — разорван цикл users↔auth (+ путь через channels)
- **Диагноз:** `AuthModule` помечен `@Global` и в AppImports → его экспорты (`AuthService`, `JwtAuthGuard`) доступны ВЕЗДЕ без импорта. Значит `forwardRef(() => AuthModule)` в `users.module` И `channels.module` — ИЗБЫТОЧНЫ, и именно они замыкали цикл (прямой users↔auth + путь auth→users→contests→channels→auth).
- **🔬 Доказательство в коде:** `contests.controller` использует `@UseGuards(JwtAuthGuard)`, а `contests.module` AuthModule НЕ импортит — и app собирается. Т.е. @Global-путь уже работал; users/channels могли так же.
- **Сделано (с пользователем — полный разрез):** убран `AuthModule`-импорт+`forwardRef` из `users.module` и `channels.module`; в `auth.module` `forwardRef(() => UsersModule)` → обычный `UsersModule` (+ `forwardRef` убран из импорта `@nestjs/common`). Использование не тронуто (контроллеры по-прежнему `@UseGuards(JwtAuthGuard)` — резолвится глобально). Итог: `AuthModule` импортится ТОЛЬКО в AppImports; `auth→users` односторонний; auth вне всех циклов.
- **Проверка:** `yarn build` чист; `yarn test:int` → core **18/18** (поведение не изменилось) + boot **1/1** (bootstrap-smoke: DI-граф резолвится без цикла — ключевое, 18 инт-тестов этого не видят). Правило Фазы 6 соблюдено.
- **Откат:** вернуть 2 избыточных `forwardRef(() => AuthModule)` в users/channels + `forwardRef(() => UsersModule)` в auth.
- **Осталось циклов:** bot↔contests (толстый, хаб `TelegramService`), bot↔channels, contests↔contests-jobs. Приём тот же: искать избыточность (@Global/односторонняя реальная зависимость), резать, проверять boot.
- **Следующий шаг:** закоммитить разрез; затем следующий цикл (по возрастанию сложности: contests↔contests-jobs или bot↔channels, толстый bot↔contests — последним). См. блок «СЕЙЧАС».

### [2026-07-13] Фаза 6 (шаг 1) — bootstrap-smoke (сеть под разрыв циклов)
- **Зачем:** наш инт-харнесс собирает сервисы ВРУЧНУЮ (`build-services.ts`), ОБХОДЯ Nest DI → разрыв `forwardRef`-цикла может пройти 18 тестов и уронить реальный старт. Нужна сеть, которая реально поднимает Nest-контейнер.
- **Решение (с пользователем):** полный `AppModule` через `Test.createTestingModule({imports:[AppModule]}).compile()` (без `.init()` — бота/воркеры не запускаем, только сборка графа). Файл `test/integration/bootstrap.int-spec.ts` (🟢-сторож): compile проходит → провайдер из ЯДРА цикла bot↔contests (`TelegramService`) инстанцирован. При разрыве цикла неверно — compile бросит «circular dependency», тест покраснеет.
- **Env:** `validationSchema` требует `TELEGRAM_BOT_TOKEN`+`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`(≥32) — дописаны ФИКТИВНЫЕ в `.env.test` (compile без `.init()` в сеть не идёт). `.env.local` не задаёт DB-хост → к dev-БД не подключается; `env.ts` грузит `.env.test` первым, dotenv не перетирает.
- **⚠️ ГОЧИ teardown (дорого дались, важно на будущее):**
  1. **ts-jest + `import()`**: динамический `import()` падает «dynamic import callback without --experimental-vm-modules» → использовать `require()` (он ещё и выполняется в момент вызова, ПОСЛЕ `NODE_ENV='test'` — то, что нужно для отложенной загрузки AppModule).
  2. **Telegraf на compile-only**: `moduleRef.close()` зовёт shutdown-хук, nestjs-telegraf делает `bot.stop()` → «Bot is not running!» (бота не launch'или). → `close()` в try/catch (глотаем безобидное).
  3. **Заглушка бота через `overrideProvider(getBotToken())` — НЕ ДЕЛАТЬ**: ломает инициализацию nestjs-telegraf, `.compile()` ВИСНЕТ (таймаут 120с). Проверено, откатили.
  4. **Остаточные хендлы**: полный AppModule тащит BullMQ-воркеры/TypeORM-пул, close их не гасит (оборвался на telegraf) → `"forceExit": true` в `jest-integration.json`.
  5. **Кросс-контаминация (важнейшее)**: `--runInBand` = один процесс; живые BullMQ-воркеры bootstrap'а сбивают ТАЙМИНГ барьера в F1-гонке (`winner-draw-race`) → тот флакует. → **изоляция**: `test:int` = `test:int:core` (18 сьютов, bootstrap исключён `--testPathIgnorePatterns`) `&&` `test:int:boot` (только bootstrap, отдельный процесс). Разные процессы → фон bootstrap не пересекается с F1.
- **Проверка:** `yarn test:int` → core **18/18** (F1 снова зелёный) + boot **1/1**, чистый выход ~8с.
- **Откат:** удалить `bootstrap.int-spec.ts`, вернуть `test:int` к одному jest-запуску, убрать `forceExit` и 3 дамми из `.env.test`.
- **Следующий шаг:** сеть стоит — можно резать первый цикл (рекомендация: начать с самого изолированного `users↔auth`, не с толстого bot↔contests). Сначала закоммитить net. См. блок «СЕЙЧАС».

### [2026-07-13] Фаза 5 — bcrypt (консолидация на bcryptjs)
- **Дубль:** в deps лежали ОБА пакета — нативный `bcrypt` (^6, требует C++-сборки под платформу) и чистый JS `bcryptjs` (^3). Код разъехался: `user-admin.service.ts` СОЗДАВАЛ хеши через `bcryptjs.hash`, а `auth.service.ts` ПРОВЕРЯЛ через нативный `bcrypt.compare`.
- **Решение:** консолидировать на `bcryptjs` (без нативной сборки → проще деплой/Docker; уже используется в user-admin). Хеши обеих библиотек — стандартный формат bcrypt (`$2a$`/`$2b$`, соль внутри), потому кросс-совместимы.
- **Сделано (прод):** `auth.service.ts` — импорт `bcrypt` → `bcryptjs` (единственная строка логики, `compare`, не тронута). `package.json` — удалены `bcrypt` + `@types/bcrypt`; `yarn.lock` пересобран (нативный bcrypt вычищен). Grep подтверждает: нативных импортов `bcrypt` в коде НЕ осталось; потребители — `user-admin.service.ts` (hash) и `auth.service.ts` (compare), оба на `bcryptjs`.
- **Тест:** новый юнит `auth-password.spec.ts` (🟢, БД не нужна): (1) `bcryptjs.compare` верифицирует хеш, сделанный НАТИВНЫМ bcrypt (эмуляция «старого» хеша из БД) → существующих НЕ разлогинит; (2) round-trip `hash → compare` (верный=true, неверный=false). `yarn test auth-password` → **2/2 зелёных** (нативный хеш прошёл проверку за 119ms). `yarn build` чист (удаление `@types/bcrypt` ничего не сломало — типы bcryptjs покрывают оба вызова).
- **Гочи/заметки:** ключевой риск смены парольной либы — разлогинить существующих; закрыт тестом кросс-совместимости на реальном нативном хеше. Auth в инт-харнесс не входит (нет DB-теста), поэтому проверка — юнит + build.
- **Откат:** вернуть `bcrypt`+`@types/bcrypt` в `package.json` + `yarn install`; импорт в `auth.service.ts` обратно на `bcrypt`; удалить `auth-password.spec.ts`.
- **Следующий шаг:** Фаза 6 (infra/telegram + разрыв циклов) или Фаза 8 (структура) — см. блок «СЕЙЧАС».

### [2026-07-13] Фаза 8 — РАЗВЕДКА + микрошаг 8.1-a (убрана contests/commons)
- **Разведка структуры:** разрозненно лежат `src/common/` (decorators/dtos/filters/helpers/interceptors), `src/shared/` (commons/decorators/enums/types/validators) и module-local `src/modules/contests/commons/`. Цель Фазы 8 (8.1–8.4): один `common/`, единые имена `kebab-case.<type>.ts`, убрать barrels в кросс-DI, снять дубли `shared/types` (зеркало dto).
- **Метод Фазы 8 (важно, отличается от 2–5):** поведение НЕ меняем → характеризационные тесты писать не на что. Сеть безопасности = **компилятор (`yarn build`) + существующие 18 инт-тестов**. Правило шага: после переноса build чист И 18/18 зелёные. Двигаемся микрошагами от наименьшего радиуса импортов к наибольшему.
- **Разведка циклов (для будущей Фазы 6, НЕ трогали):** плотная сеть `forwardRef` — взаимные кольца модулей: bot↔contests (толстое, хаб `TelegramService` в `bot/bot.service.ts`), bot↔channels, contests↔contests-jobs, users↔auth. **Подвох:** наш инт-харнесс собирает сервисы вручную, ОБХОДЯ Nest DI/bootstrap — значит разрыв цикла может пройти тесты и уронить реальный старт. Перед Фазой 6 нужен bootstrap-smoke (`Test.createTestingModule().compile()`). Отложено.
- **Сделано (8.1-a, радиус=1):** `contests/commons/contest-image.interceptor.ts` (это НЕ интерцептор — экспортит `contestImageUploadOptions` для multer; contest-специфичен) → перенесён в новую `contests/interceptors/`, папка `commons/` удалена. Импорт в `contests.controller.ts` обновлён (`./commons/…` → `./interceptors/…`). Решение (с пользователем): держать в модуле contests, НЕ тащить в глобальный `common/` (иначе протечка домена конкурсов в общее). Внутренний импорт файла на `src/shared/commons/constants/storage.constants` НЕ тронут — отдельный будущий микрошаг.
- **Проверка:** `yarn build` чист (контроллер компилируется — путь резолвится; инт-тесты контроллер НЕ грузят, поэтому build здесь решающий), `yarn test:int` → **18/18 зелёных**.
- **Откат:** вернуть файл в `contests/commons/`, откатить импорт контроллера.
- **Микрошаг 8.1-b (радиус=19):** `src/shared/commons/{constants,response}` → `src/common/{constants,response}`; папка `src/shared/commons/` удалена (худшее имя — commons в shared). Импорты в 19 файлах: строка `src/shared/commons/` → `src/common/` (детерминированный sed, чистое переименование пути, содержимое не тронуто). Коллизий не было (в `common/` не было `constants/`/`response/`); внутренние импорты файлов — только относительный `./tokens` и node `path`, переезд пережили. Проверка: `yarn build` чист (решающая — контроллеры в инт-тесты не грузятся), `yarn test:int` → **18/18**. Откат: `mv` обратно + вернуть путь. **В `shared/` осталось:** `decorators` (0 импортёров — под вопросом dead-code), `validators` (1), `types` (6, это 8.4 — семантика vs dto), `enums` (34 — самый широкий, напоследок).
- **Полная карта Фазы 8 (радиусы импортёров):** `shared/enums`=34, `shared/types`=6, `shared/validators`=1, `shared/decorators`=0. Barrels (`index.ts`, кандидаты на 8.3) в `shared/decorators`, `shared/enums/*`, `shared/types/*`, `common/decorators`.
- **Микрошаг 8.x (dead-code + validators):** (1) `shared/decorators/` (roles.decorator + barrel) — **УДАЛЁН как мёртвый код**: `@Roles`/`ROLES_KEY` определены, но нигде не применены; `RolesGuard` не существует; ни один Reflector не читает `'roles'`; barrel никто не импортит. **Наблюдение (безопасность 🔴):** RBAC был заложен (декоратор ролей), но НЕ подключён — guard'а нет, роль на роутах не проверяется, доступ держится только на `JwtAuthGuard` (аутентификация без разбора ролей). Решение (с пользователем): удалить (вернуть из git тривиально, если RBAC допилят). (2) `shared/validators/is-future-date.validator.ts` (радиус 1) → `common/validators/`, импорт в `create-contest.dto.ts` обновлён. Проверка: `yarn build` чист + `yarn test:int` **18/18**. **В `shared/` осталось только `enums` (34) и `types` (6).**
- **Микрошаг 8.4 (types → модули, ПЕРЕОСМЫСЛЕН):** план звал `shared/types` «зеркалом dto» под удаление — **отменено.** Пользователь пояснил задумку: **DTO живёт в контроллере (граница HTTP + валидация), type — форма для бизнес-логики домена.** Код подтверждает: DTO `implements` тип (`CreateContestDto implements Omit<CreateContest,'creatorId'>`, `CreateChannelDto implements Omit<CreateChannel,'id'|'isActive'|'createdAt'>`, `CreateUserAdminDto implements CreateUserAdmin`) — тип = контракт формы, DTO = его HTTP-реализация минус серверные поля. Это осмысленная связка, НЕ дубль. Каждый тип импортируется ТОЛЬКО внутри своего модуля → перенесены по домам (решение с пользователем, как интерцептор — доменное не тащим в глобальный common): `shared/types/contests`→`modules/contests/types`, `channel`→`modules/channels/types`, `users`→`modules/users/types` (barrel `index.ts` переехал вместе). 6 импортов обновлены (3 доменных sed). Внутренние импорты типов на `src/shared/enums/*` живы (enums пока в shared). Проверка: `yarn build` чист + `yarn test:int` **18/18**. **`shared/` схлопнулся до единственной `enums`.**
- **Микрошаг 8.1-c (ФИНАЛ, enums → common):** `src/shared/enums` → `src/common/enums` (9 enum в bot/channel/contest/user). Решение (с пользователем): всё в глобальный `common/enums/`, НЕ по модулям — enum это dependency-free leaf-значения (нет DI/циклов), и часть используется кросс-модульно (`channel-type`, `user-role` тянет и contests; contests вообще тяжёлый потребитель чужих enum). Правило «доменное не в common» применяем к поведению/контрактам, а не к голым enum. Sed `src/shared/enums`→`src/common/enums` по 33 файлам. **`src/shared/` удалён ПОЛНОСТЬЮ.**
- **⚠️ ГОЧА (важный урок про перенос файлов):** первый прогон дал ДВЕ поломки, которые grep по `src/shared/...` пропустил, а сеть безопасности поймала: (1) **`yarn build` упал** на ОДНОМ импорте, записанном ОТНОСИТЕЛЬНЫМ путём (`../../../shared/enums/...` в `contest-write-repository.interface.ts`) — абсолютный grep его не видел; (2) **`yarn test:int` упал** — 6 файлов в `test/` (`fixtures.ts` + спеки) ссылались на `src/shared/enums`, а мои grep/sed шли только по `src/`, не по `test/` (`yarn build` компилит только `src/`, потому был зелёным при сломанных тестах). **Правило впредь при переносах: grep без префикса (`grep "shared/"`) по ОБОИМ деревьям `src/ test/`, ловить и относительные, и абсолютные пути.** Сеть (build + инт-тесты) отработала как задумано — ошибку поймали до коммита.
- **Проверка (после починки):** `yarn build` чист + `yarn test:int` **18/18**.
- **Откат Фазы 8:** структурный, вернуть `src/shared/` из git (`git checkout` до этих коммитов) — поведение всё время не менялось, тесты те же 18.
- **Следующий шаг:** Фаза 8 ЗАКРЫТА. Дальше по плану: Фаза 6 (циклы 🟡, но сперва bootstrap-smoke — инт-харнесс обходит Nest DI) ИЛИ лёгкие Фазы 9/10/11 (🟢). Решить с пользователем. См. блок «СЕЙЧАС».
