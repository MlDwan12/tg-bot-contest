# Структура проекта — разбор и целевая раскладка

> Сопровождает [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md). Отдельный документ, чтобы по нему
> можно было перестраивать структуру проекта качественно и целостно.
> **Цель:** максимальная читаемость + простота поддержки + расширяемость силами **1 бекенд-разработчика**.
> **Путь:** эволюционный (strangler), НЕ переписывание с нуля.

> **Про «масштабирование»:** инфраструктурное масштабирование НЕ требуется (см. Q1 — нагрузка лёгкая, запас на годы).
> Здесь под «масштабируемостью» понимается **расширяемость кодовой базы** — лёгкость добавить фичу/тип конкурса
> без боли, а не рост числа серверов.

**Легенда:** ✅ сильно / ⚠️ мешает / 🎯 цель.

---

## 0. Архитектурный подход — РЕШЕНО
- **Макро:** модульный монолит, один процесс (Q1/Q6 — микросервисы неоправданы).
- **Микро:** **прагматичный слоёный (идиоматичный NestJS):** `Controller → Service → Repository (один на агрегат)`.
- **Порты/интерфейсы — только на внешний I/O** (Telegram-транспорт), чтобы фейкать в тестах. Репозитории тестируем против **реального Postgres** → интерфейсы им НЕ нужны.
- **Отвергнуто:** Clean/Hexagonal и полный DDD+CQRS — удваивают церемонию, которая и есть текущая боль (Q3.2: «архитектура большой команды в руках одного»). Урок — отступить к прагматичному слою, а не доделывать Clean Arch.
- **Прямые следствия для структуры:** `interfaces/` убрать (кроме порта Telegram) · один репозиторий на агрегат · `telegram/` — листовой адаптер · ноль `forwardRef`.

---

## 1. Текущая структура (факт)

```
src/
├── main.ts, app.module.ts
├── common/          # cross-cutting #1: decorators, dtos, filters, helpers, interceptors
├── shared/          # cross-cutting #2: commons/{constants,response}, decorators, enums, types, validators
├── config/          # config module, validation.schema
├── database/        # data-source, migrations (14 шт.)
├── logger/          # pino
├── health/          # health checks (+ ещё channels/services/health.service.ts)
├── queues/          # BullMQ root + monitoring
└── modules/
    ├── auth/        # controllers, dto, guards, services, strategies
    ├── bot/         # bot.module, bot.service(=TelegramService), bot.update, bot.constants
    ├── channels/    # controller, dto, entities, interfaces, repositories, services
    ├── contests/    # controller, commons, dto, entities, interfaces, jobs/{processors,services}, repositories, services
    └── users/       # controller, dto, entities, guard, interfaces, jobs, repositories, services
```

---

## 2. ✅ Структурные сильные стороны (НЕ ломать)
- **Feature-модули под `modules/`** — правильный макро-каркас NestJS; домены разделены.
- **Единообразная раскладка внутри модуля** (dto/entities/repositories/services) — предсказуемо, легко искать.
- **Джобы колокированы с доменом** (`contests/jobs`, `users/jobs`), а не в глобальной свалке.
- **Миграции ведутся** — дисциплина эволюции схемы.
- **Cross-cutting инфраструктура вынесена** (config/logger/health/queues/database top-level) — разумно.

---

## 3. ⚠️ Структурные проблемы (по убыванию боли для читаемости)

| # | Проблема | Где | Почему мешает | Цель |
|---|----------|-----|---------------|------|
| S1 | **Три ведра «разное»** без правила | `common/`, `shared/`, `shared/commons/`, `contests/commons/` | В `common/` и `shared/` оба есть `decorators/`; `shared/commons/` — ведро в ведре. Надо гадать, куда класть/где искать | Слить в ОДНО ведро с плоскими подкатегориями |
| S2 | **`shared/types/` дублирует `dto/`** | `shared/types/contests/*.type.ts` vs `contests/dto/*.dto.ts` | Один и тот же shape в двух местах → рассинхрон при правке | DTO=транспорт, entity=хранение; зеркало `types/` убрать |
| S3 | **Barrel `index.ts` почти везде** | все папки | Уже дал баг циклического импорта (коммит `b106c98`); усилитель циклов Q3.1 | Barrels только в листовых util-папках; в кросс-DI модулях убрать |
| S4 | **CQRS-церемония раздувает дерево** | `*/interfaces/` + `*/repositories/` (read+write) | 7 интерфейсов + 6 репо на 1 агрегат «контест» — гора файлов для соло (Q3.2) | Один репозиторий на агрегат |
| S5 | **Разнобой именования файлов** | `allExceptionsFilter.ts` vs `sentry.filter.ts`; `paginationQuery.dto.ts` vs `create-contest.dto.ts` | Бьёт по grep и чтению | Одна конвенция: `kebab-case.<type>.ts` |
| S6 | **`bot/` смешивает транспорт и домен** | `bot.service.ts`(=Telegram) + `bot.update.ts` | Корень циклов `forwardRef` (Q3.1) | Транспорт → листовой `telegram/` |
| S7 | **Разбросанные мелочи** | `users/guard/`(singular) vs `auth/guards/`; health в 2 местах; `contest-winner-msg.entity` (используется?) | Мелкий шум, накапливается | Причесать при касании |

---

## 4. 🎯 Целевые принципы (под соло-разработчика)

1. **Одно ведро cross-cutting, а не три.** `common/` (или `shared/`) с плоскими подкатегориями. Убрать `commons`-в-`shared` и `contests/commons`.
2. **Одна конвенция именования** — NestJS-стиль: `x.service.ts`, `x.controller.ts`, `x.dto.ts`, `x.entity.ts`, `x.repository.ts`, `x.processor.ts`.
3. **Feature-first модули, упрощённая внутренняя раскладка.** На агрегат: `module / controller / service(s) / repository / entities / dto / jobs`. Папку `interfaces/` — только там, где реально нужен шов для теста/подмены, а не по умолчанию.
4. **Явное направление зависимостей + листовые модули.** `telegram/` (транспорт) и `common/` — листья; доменные модули зависят только вниз. **Ноль `forwardRef`.**
5. **Barrels экономно** — не в модулях, участвующих в кросс-модульном DI (защита от циклов).
6. **Один репозиторий на агрегат** (схлопнуть read/write, Q3.2) — меньше файлов, тот же функционал.

---

## 5. 📁 Целевая структура — ФИНАЛ (чертёж)

Решено: единое ведро = **`common`**, инфраструктура сгруппирована под **`infra/`**.

```
src/
├── main.ts
├── app.module.ts
├── config/                       # env-валидация, config module
├── database/                     # data-source, migrations
├── common/                       # ЕДИНОЕ cross-cutting (было common/ + shared/ + */commons/)
│   ├── constants/                # DI-токены, storage         ← shared/commons/constants
│   ├── decorators/               # user-id, roles             ← merge common+shared/decorators
│   ├── dto/                      # pagination, response       ← common/dtos + shared/commons/response
│   ├── enums/                    # bot, channel, contest, user← shared/enums
│   ├── filters/                  # all-exceptions, sentry
│   ├── helpers/                  # admin-ids, pagination, image
│   ├── interceptors/             # response
│   ├── types/                    # ТОЛЬКО реальные доменные типы (не зеркало dto) ← shared/types (после чистки S2)
│   └── validators/               # is-future-date
├── infra/                        # инфраструктурные листовые модули (зависят вниз, домен на них — сверху)
│   ├── logger/                   # pino
│   ├── health/                   # health checks
│   ├── queues/                   # BullMQ root + monitoring
│   └── telegram/                 # ← НОВЫЙ листовой адаптер (рвёт циклы forwardRef, S6/Q3.1)
│       ├── telegram.module.ts
│       ├── telegram.service.ts   # send / getChatMember / editMessage + единый rate-limit (Q3.4)
│       └── telegram.port.ts      # интерфейс ITelegramTransport — единственный порт (для фейка в тестах)
└── modules/                      # доменные фичи (Controller → Service → Repository)
    ├── auth/
    │   ├── auth.module.ts  auth.controller.ts  auth.service.ts
    │   └── dto/  guards/  strategies/
    ├── bot/                       # ТОЛЬКО доменные хэндлеры Telegraf (BotUpdate)
    │   ├── bot.module.ts  bot.update.ts
    ├── channels/
    │   ├── channels.module.ts  channels.controller.ts  channels.service.ts
    │   ├── channels.repository.ts        # ОДИН (было read+write+interfaces)
    │   └── dto/  entities/
    ├── contests/
    │   ├── contests.module.ts  contests.controller.ts
    │   ├── dto/  entities/  jobs/{processors,services}/
    │   ├── repositories/                 # ОДИН на агрегат (было 6 репо + 7 интерфейсов)
    │   │   ├── contest.repository.ts
    │   │   ├── contest-participation.repository.ts
    │   │   ├── contest-winner.repository.ts
    │   │   └── contest-publication.repository.ts
    │   └── services/                     # lifecycle, participate, publication, winner, contests
    └── users/
        ├── users.module.ts  users.controller.ts
        ├── users.repository.ts           # ОДИН (было user-read + user-write + interfaces)
        └── dto/  entities/  jobs/  services/   # users, admin, tg, mailing, mailing-cleanup
```

### Переезды «было → стало» (ключевые)
| Было | Стало | Основание |
|------|-------|-----------|
| `common/` + `shared/` + `shared/commons/` + `contests/commons/` | один `common/` (плоские подкатегории) | S1 |
| `shared/types/*` (зеркало dto) | `common/types/` только реальные типы; дубли → удалить | S2 |
| `index.ts` в кросс-DI модулях | без barrels (оставить лишь в листовых util) | S3 |
| `*/interfaces/*-read/-write` + `*/repositories/*-read/-write` | один `*.repository.ts` на агрегат | S4 / раздел 0 |
| `allExceptionsFilter.ts`, `paginationQuery.dto.ts`, … | `kebab-case.<type>.ts` везде | S5 |
| `bot/bot.service.ts` (TelegramService) | `infra/telegram/telegram.service.ts` + `telegram.port.ts` | S6 / Q3.1 |

---

## 6. 🔀 Как переходить (эволюционно, не big-bang)
- Структурные переезды делать **вместе с уже запланированными шагами** review, а не отдельным «большим рефакторингом»:
  - `infra/telegram/` выделяется на шаге 6 плана (TelegramTransportModule — рвёт циклы).
  - Слияние `common`+`shared` (S1), конвенция имён (S5), уборка barrels (S3) — часть «быстрых побед» (низкий риск), но делать **после** тестов на горячие пути (⓿).
  - Схлопывание CQRS (S4) — **оппортунистически**: трогаешь агрегат по делу → заодно объединяешь его read+write.
- Каждый переезд — отдельный коммит, компилируется и проходит тесты. Откат = ревёрт коммита.

---

## 7. Решения
- [x] Микро-архитектура: **прагматичный слоёный** (раздел 0). ✅
- [x] Судьба `interfaces/`: **убрать** (кроме порта Telegram). ✅
- [x] Имя единого ведра: **`common`**. ✅
- [x] Инфраструктура сгруппирована под **`infra/`**. ✅
- [ ] Перед переездом проверить «живость»: `contest-winner-msg.entity`, `bot.constants`, `shared/types/*` (что реально используется).

**Структура ФИНАЛИЗИРОВАНА** — раздел 5 является чертёжом для перестройки. Переезды делаем эволюционно (раздел 6), после тестов на горячие пути (⓿ плана в ARCHITECTURE_REVIEW.md).
