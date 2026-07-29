/**
 * Продвигает отложенный джоб BullMQ — дедлайн наступает немедленно.
 * Нужен для ручной проверки просрочки подтверждения: ждать confirmationHours
 * (минимум час) вживую незачем.
 *
 * Использование:
 *   node scripts/promote-job.js contest-winner-confirm contest:23:deadline-11
 *
 * Правка confirmationDeadline в БД тут НЕ поможет: джоб уже поставлен с
 * задержкой и про базу ничего не знает.
 */
const { Queue } = require('bullmq');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.development' });

const [queueName, jobId] = process.argv.slice(2);

if (!queueName || !jobId) {
  console.error('Использование: node scripts/promote-job.js <очередь> <jobId>');
  process.exit(1);
}

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB) || 0,
};

(async () => {
  const queue = new Queue(queueName, {
    connection,
    prefix: process.env.BULL_PREFIX || 'new-v-telegram-bot-dev',
  });

  try {
    const job = await queue.getJob(jobId);

    if (!job) {
      console.error(`Джоб ${jobId} не найден в очереди ${queueName}`);
      process.exitCode = 1;
      return;
    }

    const state = await job.getState();
    console.log(`Джоб ${jobId}: состояние = ${state}`);

    if (state !== 'delayed') {
      console.error(
        `Продвинуть можно только отложенный джоб. Сейчас: ${state}. ` +
          `Если 'completed' — дедлайн уже отработал.`,
      );
      process.exitCode = 1;
      return;
    }

    await job.promote();
    console.log(`✅ Джоб ${jobId} продвинут — воркер возьмёт его немедленно.`);
  } finally {
    await queue.close();
  }
})();
