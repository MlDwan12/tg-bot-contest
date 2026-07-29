import { ContestWinnerConfirmationService } from './contest-winner-confirmation.service';
import { ContestWinnerStatus } from 'src/common/enums/contest';

const OWNER_TELEGRAM_ID = '750482759';

function build(
  options: {
    winner?: Record<string, any> | null;
    resolved?: boolean;
  } = {},
) {
  const resolveCalls: Array<{
    id: number;
    status: ContestWinnerStatus;
    confirmedAt: Date | null;
  }> = [];

  const winner =
    options.winner === undefined
      ? {
          id: 15,
          contestId: 7,
          userId: 42,
          place: 1,
          status: ContestWinnerStatus.PENDING_CONFIRMATION,
          confirmationDeadline: new Date(Date.now() + 60 * 60 * 1000),
          user: { id: 42, telegramId: OWNER_TELEGRAM_ID },
        }
      : options.winner;

  const contestWinnerRepo = {
    findById: async () => winner,
    resolveConfirmation: async (
      id: number,
      status: ContestWinnerStatus,
      confirmedAt: Date | null,
    ) => {
      resolveCalls.push({ id, status, confirmedAt });
      return options.resolved ?? true;
    },
  } as any;

  const vacatedJobs: Array<{ name: string; data: any; opts: any }> = [];
  const confirmQueue = {
    add: async (name: string, data: any, opts: any) => {
      vacatedJobs.push({ name, data, opts });
      return { id: 'job' };
    },
  } as any;

  const logger = { log() {}, warn() {}, error() {}, debug() {} } as any;

  const service = new ContestWinnerConfirmationService(
    contestWinnerRepo,
    confirmQueue,
    logger,
  );

  return { service, resolveCalls, vacatedJobs };
}

describe('ContestWinnerConfirmationService', () => {
  it('владелец подтверждает → CONFIRMED с отметкой времени', async () => {
    const { service, resolveCalls } = build();

    const outcome = await service.confirm(15, OWNER_TELEGRAM_ID);

    expect(outcome).toBe('confirmed');
    expect(resolveCalls).toHaveLength(1);
    expect(resolveCalls[0].status).toBe(ContestWinnerStatus.CONFIRMED);
    expect(resolveCalls[0].confirmedAt).toBeInstanceOf(Date);
  });

  it('владелец отказывается → DECLINED, время подтверждения не ставится', async () => {
    const { service, resolveCalls } = build();

    const outcome = await service.decline(15, OWNER_TELEGRAM_ID);

    expect(outcome).toBe('declined');
    expect(resolveCalls[0].status).toBe(ContestWinnerStatus.DECLINED);
    expect(resolveCalls[0].confirmedAt).toBeNull();
  });

  it('кнопку нажал не владелец → отказ, статус не трогаем', async () => {
    const { service, resolveCalls } = build();

    // callback_data содержит только id строки, а сообщение можно переслать —
    // без этой проверки чужой отказ освободил бы место победителя.
    const outcome = await service.decline(15, '111111');

    expect(outcome).toBe('foreign');
    expect(resolveCalls).toHaveLength(0);
  });

  it('срок истёк → решение не принимается', async () => {
    const { service, resolveCalls } = build({
      winner: {
        id: 15,
        contestId: 7,
        userId: 42,
        status: ContestWinnerStatus.PENDING_CONFIRMATION,
        confirmationDeadline: new Date(Date.now() - 1000),
        user: { id: 42, telegramId: OWNER_TELEGRAM_ID },
      },
    });

    // Джоб дедлайна мог ещё не отработать (очередь отстаёт), но подтверждать
    // задним числом нельзя — место уже считается освободившимся.
    expect(await service.confirm(15, OWNER_TELEGRAM_ID)).toBe('expired');
    expect(resolveCalls).toHaveLength(0);
  });

  it('решение уже принято → повторное нажатие ничего не меняет', async () => {
    const { service, resolveCalls } = build({
      winner: {
        id: 15,
        contestId: 7,
        userId: 42,
        status: ContestWinnerStatus.CONFIRMED,
        confirmationDeadline: new Date(Date.now() + 60 * 60 * 1000),
        user: { id: 42, telegramId: OWNER_TELEGRAM_ID },
      },
    });

    expect(await service.confirm(15, OWNER_TELEGRAM_ID)).toBe(
      'already_resolved',
    );
    expect(resolveCalls).toHaveLength(0);
  });

  it('гонка: статус сменился между чтением и записью → already_resolved', async () => {
    const { service } = build({ resolved: false });

    // Двойной клик или джоб дедлайна успели первыми. Условный UPDATE вернул
    // affected=0 — победила первая операция, и это нормальный исход.
    expect(await service.confirm(15, OWNER_TELEGRAM_ID)).toBe(
      'already_resolved',
    );
  });

  it('отказ ставит джоб автодобора с ключом по строке, а не по месту', async () => {
    const { service, vacatedJobs } = build();

    await service.decline(15, OWNER_TELEGRAM_ID);

    expect(vacatedJobs).toHaveLength(1);
    expect(vacatedJobs[0].data).toEqual({ contestId: 7, place: 1 });

    // На одном месте отказаться может несколько человек подряд: ключ по месту
    // был бы занят первым отказом, и BullMQ молча не создал бы второй джоб.
    expect(vacatedJobs[0].opts.jobId).toBe('contest:7:vacated-15');
  });

  it('подтверждение автодобор не запускает', async () => {
    const { service, vacatedJobs } = build();

    await service.confirm(15, OWNER_TELEGRAM_ID);

    expect(vacatedJobs).toHaveLength(0);
  });

  it('строка победителя не найдена', async () => {
    const { service } = build({ winner: null });

    expect(await service.confirm(15, OWNER_TELEGRAM_ID)).toBe('not_found');
  });
});
