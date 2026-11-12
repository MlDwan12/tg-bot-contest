import { createHmac } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { ContestsController } from './contests.controller';
import {
  ContestLifecycleService,
  ContestsParticipateService,
  ContestsService,
  ContestWinnerService,
} from './services';

const NEW_TOKEN = '111:new-bot';
const LEGACY_TOKEN = '222:old-bot';

/** initData так, как её подписывает Telegram ботом с этим токеном. */
function sign(token: string): string {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 42, username: 'ivan' }),
  };
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k as keyof typeof fields]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

/**
 * Юнит: на время переезда участие принимает подпись Mini App и нового,
 * и старого бота (LEGACY_BOT_TOKEN); чужую — нет.
 */
describe('ContestsController.participate — initData двух ботов', () => {
  let participate: jest.Mock;
  let controller: ContestsController;

  beforeEach(() => {
    participate = jest.fn();
    const env: Record<string, string> = {
      TELEGRAM_BOT_TOKEN: NEW_TOKEN,
      LEGACY_BOT_TOKEN: LEGACY_TOKEN,
    };
    const config = {
      get: (key: string) => env[key],
      getOrThrow: (key: string) => env[key],
    } as unknown as ConfigService;
    controller = new ContestsController(
      {} as ContestsService,
      {} as ContestLifecycleService,
      { participate } as unknown as ContestsParticipateService,
      {} as ContestWinnerService,
      {} as Logger,
      config,
    );
  });

  it.each([
    ['нового', NEW_TOKEN],
    ['старого', LEGACY_TOKEN],
  ])(
    'подпись %s бота — юзер из подписи, telegramId тела игнорируется',
    async (_, token) => {
      await controller.participate(1, {
        initData: sign(token),
        telegramId: '999',
        groupId: 'g',
      });
      expect(participate).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ telegramId: '42', username: 'ivan' }),
      );
    },
  );

  it('подпись чужого бота — 401', async () => {
    await expect(
      controller.participate(1, {
        initData: sign('333:alien'),
        groupId: 'g',
      } as never),
    ).rejects.toThrow(UnauthorizedException);
    expect(participate).not.toHaveBeenCalled();
  });
});
