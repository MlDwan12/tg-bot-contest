import { buildWinnerNotificationText } from './contest-winner-message.util';

describe('buildWinnerNotificationText', () => {
  it('первое место получает медаль', () => {
    expect(
      buildWinnerNotificationText({ contestName: 'Розыгрыш', place: 1 }),
    ).toBe('🥇 Поздравляем! Вы заняли 1 место в конкурсе «Розыгрыш».');
  });

  it('места с четвёртого идут без медали', () => {
    expect(
      buildWinnerNotificationText({ contestName: 'Розыгрыш', place: 4 }),
    ).toBe('Поздравляем! Вы заняли 4 место в конкурсе «Розыгрыш».');
  });

  it('HTML в названии конкурса экранируется — иначе ломается всё сообщение', () => {
    expect(
      buildWinnerNotificationText({ contestName: 'Приз <b>1', place: 2 }),
    ).toBe('🥈 Поздравляем! Вы заняли 2 место в конкурсе «Приз &lt;b&gt;1».');
  });
});
