import { TelegramUserService } from './user-tg.service';
import { UsersService } from './users.service';
import { TelegramService } from 'src/modules/bot/bot.service';
import { User } from '../entities';

/**
 * Юнит: /start в боте отмечает, что боту можно писать юзеру (botStartedAt).
 * Правило: дата ставится один раз — повторный /start её не двигает.
 */
describe('TelegramUserService.registerBotStart', () => {
  const from = { id: 42, username: 'ivan', first_name: 'Иван' };
  let users: jest.Mocked<
    Pick<UsersService, 'findByTelegramId' | 'create' | 'save'>
  >;
  let service: TelegramUserService;

  beforeEach(() => {
    users = {
      findByTelegramId: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    service = new TelegramUserService(
      users as unknown as UsersService,
      {} as TelegramService,
    );
  });

  it('нового юзера создаёт сразу с botStartedAt', async () => {
    users.findByTelegramId.mockResolvedValue(null);
    await service.registerBotStart(from);
    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: '42',
        username: 'ivan',
        firstName: 'Иван',
        botStartedAt: expect.any(Date) as Date,
      }),
    );
  });

  it('существующему без даты — ставит её', async () => {
    const user = { telegramId: '42', botStartedAt: null } as User;
    users.findByTelegramId.mockResolvedValue(user);
    await service.registerBotStart(from);
    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({ botStartedAt: expect.any(Date) as Date }),
    );
  });

  it('повторный /start дату не трогает', async () => {
    const first = new Date('2026-10-01');
    users.findByTelegramId.mockResolvedValue({
      telegramId: '42',
      botStartedAt: first,
    } as User);
    await service.registerBotStart(from);
    expect(users.save).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
  });
});
