import { ContestWinnerNotifyProcessor } from './contest-winner-notify.processor';
import { BotMessageContentType, BotMessageType } from 'src/common/enums/bot';

/**
 * Отказ Telegram в том виде, в каком его отдаёт telegraf: код и описание лежат
 * в error.response. 403 — самый частый исход в проде: участники приходят из
 * мини-аппа и бота обычно не запускали, а первым бот писать не может.
 */
function telegramError(errorCode: number, description: string) {
  return Object.assign(new Error(description), {
    response: { error_code: errorCode, description },
  });
}

function makeJob(overrides: Record<string, any> = {}) {
  return {
    id: 'contest:7:winner-42',
    name: 'notify-winner',
    queueName: 'contest-winner-notify',
    attemptsMade: 0,
    opts: { attempts: 3 },
    data: {
      contestId: 7,
      userId: 42,
      telegramId: '750482759',
      text: '🥇 Поздравляем! Вы заняли 1 место в конкурсе «Тест».',
    },
    ...overrides,
  } as any;
}

function build(
  options: {
    send?: () => Promise<{ messageId: number; chatId: string }>;
    alreadySent?: boolean;
    onSummary?: () => Promise<void>;
  } = {},
) {
  const failedCalls: any[] = [];
  const sentCalls: any[] = [];
  const summaryCalls: number[] = [];
  let sendAttempts = 0;

  const botMessageRepo = {
    existsSent: async () => options.alreadySent ?? false,
    recordSent: async (params: any) => {
      sentCalls.push(params);
    },
    recordFailed: async (params: any) => {
      failedCalls.push(params);
    },
  } as any;

  const contestWinnerNotifyService = {
    enqueueSummaryIfComplete: async (contestId: number) => {
      summaryCalls.push(contestId);
      if (options.onSummary) await options.onSummary();
    },
  } as any;

  const telegramService = {
    sendMailingMessage: async () => {
      sendAttempts++;
      return options.send
        ? options.send()
        : { messageId: 645, chatId: '750482759' };
    },
  } as any;

  const logger = { log() {}, warn() {}, error() {}, debug() {} } as any;

  const processor = new ContestWinnerNotifyProcessor(
    botMessageRepo,
    contestWinnerNotifyService,
    telegramService,
    logger,
  );

  return {
    processor,
    failedCalls,
    sentCalls,
    summaryCalls,
    sendAttempts: () => sendAttempts,
  };
}

describe('ContestWinnerNotifyProcessor: notify-winner', () => {
  it('403 «бот не может писать первым» → FAILED, джоб не падает и не ретраится', async () => {
    const harness = build({
      send: async () => {
        throw telegramError(
          403,
          "Forbidden: bot can't initiate conversation with a user",
        );
      },
    });

    // Джоб обязан завершиться УСПЕШНО: 403 — не сбой доставки, а отсутствие
    // права на неё. Ретраи бессмысленны, а падение джоба заставило бы BullMQ
    // молотить впустую и в итоге потерять победителя в failed-очереди.
    await expect(harness.processor.process(makeJob())).resolves.toBeUndefined();

    expect(harness.sendAttempts()).toBe(1);
    expect(harness.sentCalls).toHaveLength(0);
    expect(harness.failedCalls).toHaveLength(1);

    // chatId пишем из джоба: доставки не было, ответа Telegram с чатом тоже.
    expect(harness.failedCalls[0]).toMatchObject({
      contestId: 7,
      userId: 42,
      chatId: '750482759',
      type: BotMessageType.CONTEST_WINNER,
      contentType: BotMessageContentType.TEXT,
    });

    // Без следа в БД победитель молча остался бы неуведомлённым — именно эту
    // строку админ увидит в сводке как «не удалось уведомить».
    expect(harness.failedCalls[0].error).toContain('Forbidden');
    expect(harness.summaryCalls).toEqual([7]);
  });

  it('400 (чат не найден, юзер удалён) — тоже перманентный отказ', async () => {
    const harness = build({
      send: async () => {
        throw telegramError(400, 'Bad Request: chat not found');
      },
    });

    await expect(harness.processor.process(makeJob())).resolves.toBeUndefined();

    expect(harness.failedCalls).toHaveLength(1);
    expect(harness.failedCalls[0].error).toContain('chat not found');
    expect(harness.summaryCalls).toEqual([7]);
  });

  it('временная ошибка (429) → бросаем ради ретрая, FAILED пока не пишем', async () => {
    const harness = build({
      send: async () => {
        throw telegramError(429, 'Too Many Requests: retry after 5');
      },
    });

    await expect(harness.processor.process(makeJob())).rejects.toThrow(
      'Too Many Requests',
    );

    // Записать FAILED сейчас — значит соврать: попытки ещё есть.
    expect(harness.failedCalls).toHaveLength(0);
    expect(harness.summaryCalls).toHaveLength(0);
  });

  it('временная ошибка на последней попытке → FAILED, иначе победитель без следа', async () => {
    const harness = build({
      send: async () => {
        throw telegramError(429, 'Too Many Requests: retry after 5');
      },
    });

    // attemptsMade=2 при attempts=3 — это третья, последняя попытка.
    await expect(
      harness.processor.process(makeJob({ attemptsMade: 2 })),
    ).rejects.toThrow('Too Many Requests');

    expect(harness.failedCalls).toHaveLength(1);
    expect(harness.summaryCalls).toEqual([7]);
  });

  it('успешная отправка → SENT с messageId из ответа Telegram', async () => {
    const harness = build();

    await harness.processor.process(makeJob());

    expect(harness.failedCalls).toHaveLength(0);
    expect(harness.sentCalls).toHaveLength(1);
    expect(harness.sentCalls[0]).toMatchObject({
      contestId: 7,
      userId: 42,
      chatId: '750482759',
      telegramMessageId: 645,
      type: BotMessageType.CONTEST_WINNER,
      contentType: BotMessageContentType.TEXT,
    });
    expect(harness.summaryCalls).toEqual([7]);
  });

  it('уведомление уже отправлено → ретрай ничего не шлёт повторно', async () => {
    const harness = build({ alreadySent: true });

    await harness.processor.process(makeJob({ attemptsMade: 1 }));

    // Защита от дубля: сообщение могло уйти, а запись в БД — упасть.
    expect(harness.sendAttempts()).toBe(0);
    expect(harness.sentCalls).toHaveLength(0);
    expect(harness.failedCalls).toHaveLength(0);
  });

  it('сбой постановки сводки не роняет уже доставленное уведомление', async () => {
    const harness = build({
      onSummary: async () => {
        throw new Error('redis down');
      },
    });

    // Сводка — побочный эффект: её падение не должно приводить к ретраю и
    // повторной отправке победителю уже доставленного сообщения.
    await expect(harness.processor.process(makeJob())).resolves.toBeUndefined();

    expect(harness.sentCalls).toHaveLength(1);
  });
});
