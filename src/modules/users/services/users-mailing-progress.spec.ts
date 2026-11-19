import { UsersMailingService } from './users-mailing.service';

/** Виджет прогресса: не чаще раза в 5 с и только пока рассылка идёт. */
describe('UsersMailingService.touchProgress', () => {
  const make = (status: string, progressWidgetId: string | null = 'w1') => {
    const job = {
      id: 'mailing-1',
      status,
      progressWidgetId,
      queuedCount: 10,
      sentCount: 3,
      blockedCount: 1,
      errorCount: 0,
      skippedCount: 2,
    };
    const telegram = {
      editSharedWidgetData: jest.fn().mockResolvedValue(true),
    };
    const service = new UsersMailingService(
      {} as never,
      {} as never,
      { findOne: jest.fn().mockResolvedValue(job) } as never,
      {} as never,
      telegram as never,
      {} as never,
      { warn: jest.fn() } as never,
    );
    return { service, telegram };
  };

  it('обновляет, но второй вызов в течение 5 с пропускает', async () => {
    const { service, telegram } = make('processing');
    await service.touchProgress('mailing-1');
    await service.touchProgress('mailing-1');
    expect(telegram.editSharedWidgetData).toHaveBeenCalledTimes(1);
    const data = JSON.parse(telegram.editSharedWidgetData.mock.calls[0][1]);
    expect(data).toMatchObject({
      q: 10,
      s: 3,
      b: 1,
      e: 0,
      k: 2,
      st: 'processing',
    });
  });

  it('завершённую рассылку и рассылку без виджета не трогает', async () => {
    const done = make('completed');
    await done.service.touchProgress('mailing-1');
    expect(done.telegram.editSharedWidgetData).not.toHaveBeenCalled();

    const noWidget = make('processing', null);
    await noWidget.service.touchProgress('mailing-1');
    expect(noWidget.telegram.editSharedWidgetData).not.toHaveBeenCalled();
  });

  it('ошибка Telegram не пробрасывается — рассылка не страдает', async () => {
    const { service, telegram } = make('processing');
    telegram.editSharedWidgetData.mockRejectedValue(new Error('429'));
    await expect(service.touchProgress('mailing-1')).resolves.toBeUndefined();
  });
});
