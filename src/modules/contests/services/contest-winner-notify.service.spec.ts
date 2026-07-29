import {
  ContestWinnerNotifyService,
  WINNERS_SUMMARY_JOB,
} from './contest-winner-notify.service';

type BulkJob = {
  name: string;
  data: Record<string, any>;
  opts: { jobId?: string };
};

type AddCall = {
  name: string;
  data: Record<string, any>;
  opts: { jobId?: string };
};

/**
 * Правило BullMQ для кастомного jobId (Job.validateOptions, bullmq 5.x):
 * двоеточия допустимы, ТОЛЬКО если сегментов ровно три (совместимость со
 * старыми repeatable-джобами), а чисто числовой id запрещён. Иначе add/addBulk
 * бросают «Custom Id cannot contain :» / «Custom Id cannot be integers».
 *
 * Правило продублировано здесь намеренно: в юнит-тестах очередь замокана и
 * настоящая валидация BullMQ не отрабатывает. Именно поэтому неверный
 * `contest:<id>:winner:<userId>` (четыре сегмента) дожил до живого сервера —
 * addBulk падал, ошибку глушил catch в notifyWinners, и уведомления победителей
 * не ставились вообще, оставляя bot_messages пустой.
 */
function assertValidBullMqJobId(jobId: string | undefined): void {
  expect(typeof jobId).toBe('string');
  expect(`${parseInt(jobId as string, 10)}`).not.toBe(jobId);

  if ((jobId as string).includes(':')) {
    expect((jobId as string).split(':')).toHaveLength(3);
  }
}

/** Реальный победитель: есть строка в users и telegramId, есть кому писать. */
function realWinner(place: number, userId: number, telegramId: string) {
  return {
    place,
    userId,
    displayUsername: null,
    user: { id: userId, telegramId, username: `user${userId}` },
  };
}

/**
 * Фиктивный победитель («подкрутка»): оператор вписал ник руками, строки в
 * users нет — userId null, имя лежит в displayUsername. В Telegram такого
 * пользователя не существует, адресата нет.
 */
function fictitiousWinner(place: number, displayUsername: string) {
  return { place, userId: null, displayUsername, user: null };
}

function build(options: { winners?: any[]; contest?: any } = {}) {
  const bulkCalls: BulkJob[][] = [];
  const addCalls: AddCall[] = [];

  const contestRepo = {
    findByParams: async () =>
      options.contest === undefined
        ? { id: 7, name: 'Проверка фазы 1' }
        : options.contest,
  } as any;

  const botMessageRepo = {
    findUserIdsByStatus: async () => [],
  } as any;

  const notifyQueue = {
    addBulk: async (jobs: BulkJob[]) => {
      bulkCalls.push(jobs);
      return jobs.map((_, index) => ({ id: String(index) }));
    },
    add: async (name: string, data: any, opts: any) => {
      addCalls.push({ name, data, opts });
      return { id: 'summary' };
    },
  } as any;

  const contestWinnerService = {
    getContestWinners: async () => options.winners ?? [],
  } as any;

  const logger = { log() {}, warn() {}, error() {}, debug() {} } as any;

  const service = new ContestWinnerNotifyService(
    contestRepo,
    botMessageRepo,
    notifyQueue,
    contestWinnerService,
    logger,
  );

  return { service, bulkCalls, addCalls };
}

describe('ContestWinnerNotifyService.enqueueWinnerNotifications', () => {
  it('реальным победителям ставит джобы с jobId, который принимает BullMQ', async () => {
    const { service, bulkCalls } = build({
      winners: [realWinner(1, 42, '750482759'), realWinner(2, 5, '6717368676')],
    });

    const result = await service.enqueueWinnerNotifications(7);

    expect(result).toEqual({ queued: 2, skipped: 0 });
    expect(bulkCalls).toHaveLength(1);

    const jobIds = bulkCalls[0].map((job) => job.opts.jobId);

    // Регрессия: до фикса здесь было `contest:7:winner:42` — четыре сегмента,
    // и addBulk падал целиком, не поставив ни одного уведомления.
    expect(jobIds).toEqual(['contest:7:winner-42', 'contest:7:winner-5']);
    jobIds.forEach(assertValidBullMqJobId);

    // Идемпотентность держится на уникальности ключа по паре конкурс+юзер.
    expect(new Set(jobIds).size).toBe(jobIds.length);

    expect(bulkCalls[0].map((job) => job.name)).toEqual([
      'notify-winner',
      'notify-winner',
    ]);
    expect(bulkCalls[0][0].data).toMatchObject({
      contestId: 7,
      userId: 42,
      telegramId: '750482759',
    });
    expect(bulkCalls[0][0].data.text).toContain('1 место');
  });

  it('фиктивным победителям («подкрутка») не шлёт ничего — адресата нет', async () => {
    const { service, bulkCalls, addCalls } = build({
      winners: [fictitiousWinner(1, 'masha'), fictitiousWinner(2, 'vasya')],
    });

    const result = await service.enqueueWinnerNotifications(7);

    // Их нельзя ни уведомить, ни потерять: они уходят в skipped и попадают в
    // сводку администраторам как «уведомить некого».
    expect(result).toEqual({ queued: 0, skipped: 2 });
    expect(bulkCalls).toHaveLength(0);

    // Уведомлять некого → ни один notify-джоб не позовёт сводку, поэтому её
    // ставим сразу, иначе администратор не узнал бы о завершении вовсе.
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0].name).toBe(WINNERS_SUMMARY_JOB);
    expect(addCalls[0].opts.jobId).toBe('contest:7:winners-summary');
    assertValidBullMqJobId(addCalls[0].opts.jobId);
  });

  it('смешанный состав: джоб только реальному, фиктивный пропущен', async () => {
    const { service, bulkCalls, addCalls } = build({
      winners: [
        fictitiousWinner(1, '@ivan_petrov'),
        realWinner(2, 42, '750482759'),
      ],
    });

    const result = await service.enqueueWinnerNotifications(7);

    expect(result).toEqual({ queued: 1, skipped: 1 });
    expect(bulkCalls[0]).toHaveLength(1);
    expect(bulkCalls[0][0].data.userId).toBe(42);
    assertValidBullMqJobId(bulkCalls[0][0].opts.jobId);

    // Есть кого уведомлять → сводку поставит процессор, когда по всем
    // адресатам будет исход. Напрямую её здесь ставить нельзя: админ получил бы
    // отчёт с недосчитанными доставками.
    expect(addCalls).toHaveLength(0);
  });

  it('реальный победитель без telegramId уходит в skipped, а не в очередь', async () => {
    const { service, bulkCalls, addCalls } = build({
      winners: [
        { place: 1, userId: 42, displayUsername: null, user: { id: 42 } },
      ],
    });

    const result = await service.enqueueWinnerNotifications(7);

    expect(result).toEqual({ queued: 0, skipped: 1 });
    expect(bulkCalls).toHaveLength(0);
    expect(addCalls).toHaveLength(1);
  });

  it('конкурс не найден — молча выходим, очередь не трогаем', async () => {
    const { service, bulkCalls, addCalls } = build({
      contest: null,
      winners: [realWinner(1, 42, '750482759')],
    });

    const result = await service.enqueueWinnerNotifications(7);

    expect(result).toEqual({ queued: 0, skipped: 0 });
    expect(bulkCalls).toHaveLength(0);
    expect(addCalls).toHaveLength(0);
  });
});
