import { Logger } from 'nestjs-pino';
import { Telegraf } from 'telegraf';
import { TelegramService } from './bot.service';
import { LegacyBotService } from './legacy-bot.service';

/**
 * Юнит: checkUserInChannels отличает «не подписан» от «проверка сломалась».
 * Раньше любая ошибка Telegram считалась «не подписан» → ложное «подпишитесь».
 */
describe('TelegramService.checkUserInChannels', () => {
  const tgError = (code: number, description: string) =>
    Object.assign(new Error(description), {
      response: { error_code: code, description },
    });

  // Ответ getChatMember по id канала: статус или ошибка.
  const make = (byChannel: Record<number, unknown>) => {
    const getChatMember = jest.fn((channelId: number) => {
      const r = byChannel[channelId];
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    });
    const bot = { telegram: { getChatMember } } as unknown as Telegraf;
    return new TelegramService(
      bot,
      { bot: null } as unknown as LegacyBotService,
      {} as Logger,
    );
  };

  it('подписан везде — passed', async () => {
    const service = make({
      1: { status: 'member' },
      2: { status: 'restricted', is_member: true },
    });
    expect(await service.checkUserInChannels('42', [1, 2])).toEqual({
      passed: true,
      missingChannels: [],
      failedChannels: [],
    });
  });

  it('left и 400 «user not found» — не подписан, а не сбой', async () => {
    const service = make({
      1: { status: 'left' },
      2: tgError(400, 'Bad Request: user not found'),
    });
    const result = await service.checkUserInChannels('42', [1, 2]);
    expect(result.passed).toBe(false);
    expect(result.missingChannels.sort()).toEqual([1, 2]);
    expect(result.failedChannels).toEqual([]);
  });

  it('бот не в канале, chat not found, 429 — сбой проверки', async () => {
    const service = make({
      1: tgError(403, 'Forbidden: bot is not a member of the channel chat'),
      2: tgError(400, 'Bad Request: chat not found'),
      3: tgError(429, 'Too Many Requests: retry after 5'),
    });
    const result = await service.checkUserInChannels('42', [1, 2, 3]);
    expect(result.passed).toBe(false);
    expect(result.missingChannels).toEqual([]);
    expect(result.failedChannels.map((f) => f.code).sort()).toEqual([
      400, 403, 429,
    ]);
  });
});
