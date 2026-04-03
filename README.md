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
