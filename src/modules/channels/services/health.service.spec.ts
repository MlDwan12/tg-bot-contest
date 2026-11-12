import { Logger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { TelegramService } from 'src/modules/bot/bot.service';
import { Channel } from '../entities';
import { ChannelHealthService } from './health.service';

const ok = {
  exists: true,
  isAdmin: true,
  canPost: true,
  canEdit: true,
  isChannel: true,
};

/** Юнит: крон синхронизирует канал с Telegram и шлёт админам сводку. */
describe('ChannelHealthService.checkChannelsHealth', () => {
  let channels: Partial<Channel>[];
  let update: jest.Mock;
  let check: jest.Mock;
  let send: jest.Mock;
  let service: ChannelHealthService;
  const sentText = () => (send.mock.calls[0] as [{ text: string }])[0].text;

  beforeEach(() => {
    process.env.ADMIN_IDS = '1';
    channels = [
      {
        id: 10,
        telegramId: -100,
        telegramUsername: 'vitusRozigrish',
        name: 'ВИТУС',
        isActive: true,
      },
    ];
    update = jest.fn();
    check = jest.fn();
    send = jest.fn();
    service = new ChannelHealthService(
      {
        find: () => Promise.resolve(channels),
        update,
      } as unknown as Repository<Channel>,
      {
        checkBotChannelPermissions: check,
        sendMailingMessage: send,
        createChannelInviteLink: () => Promise.resolve('https://t.me/+new'),
      } as unknown as TelegramService,
      {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as Logger,
    );
  });

  it('переименование и смена username — обновляет БД и уведомляет', async () => {
    check.mockResolvedValue({
      ...ok,
      chat: { id: -100, title: 'ПРОФИТ <ХАТА>', username: 'profithata777' },
    });

    await service.checkChannelsHealth();

    expect(update).toHaveBeenCalledWith(10, {
      name: 'ПРОФИТ <ХАТА>',
      telegramUsername: 'profithata777',
    });
    expect(sentText()).toContain('ПРОФИТ &lt;ХАТА&gt;');
  });

  it('без изменений — ни апдейта, ни сообщения', async () => {
    check.mockResolvedValue({
      ...ok,
      chat: { id: -100, title: 'ВИТУС', username: 'vitusRozigrish' },
    });

    await service.checkChannelsHealth();

    expect(update).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('отобрали право постинга — канал отключается, админам причина', async () => {
    check.mockResolvedValue({
      ...ok,
      canPost: false,
      chat: { id: -100, title: 'ВИТУС', username: 'vitusRozigrish' },
    });

    await service.checkChannelsHealth();

    expect(update).toHaveBeenCalledWith(10, { isActive: false });
    expect(sentText()).toContain('отобраны права: публикация');
  });

  it('бота удалили — канал отключается', async () => {
    check.mockResolvedValue({ ...ok, exists: false, isAdmin: false });

    await service.checkChannelsHealth();

    expect(update).toHaveBeenCalledWith(10, { isActive: false });
    expect(sentText()).toContain('бот удалён');
  });

  it('канал стал приватным — создаётся invite-ссылка', async () => {
    check.mockResolvedValue({ ...ok, chat: { id: -100, title: 'ВИТУС' } });

    await service.checkChannelsHealth();

    expect(update).toHaveBeenCalledWith(10, {
      telegramUsername: null,
      inviteLink: 'https://t.me/+new',
    });
  });
});
