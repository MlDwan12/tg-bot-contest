import {
  escapeHtml,
  formatWinnerName,
  ResultsWinner,
} from './contest-results-text.util';

/**
 * Сколько имён показываем в каждом списке сводки. Остальные сворачиваются в
 * «…и ещё N»: у конкурса может быть много призовых мест, а личное сообщение
 * админу ограничено 4096 символами.
 */
const MAX_NAMES_IN_LIST = 20;

function formatNameList(winners: ResultsWinner[]): string {
  const shown = winners
    .slice(0, MAX_NAMES_IN_LIST)
    .map((winner) => `${winner.place}. ${formatWinnerName(winner)}`);

  const hidden = winners.length - shown.length;

  return [...shown, ...(hidden > 0 ? [`…и ещё ${hidden}`] : [])].join('\n');
}

/**
 * Сводка администраторам по завершённому конкурсу: кто победил и до кого не
 * дошло личное уведомление.
 *
 * Название конкурса экранируется — оно подставляется в наш шаблон, и незакрытый
 * оператором тег сломал бы всё сообщение (см. buildWinnerNotificationText).
 *
 * undelivered — реальные победители, которым Telegram отказал (чаще всего они
 * не запускали бота). skipped — те, кому писать некуда в принципе: фиктивные
 * победители (ник без TG-аккаунта) и записи без telegramId. Разделены, потому
 * что требуют разных действий: первым можно написать вручную, вторые — норма.
 */
export function buildWinnersSummaryText(params: {
  contestId: number;
  contestName: string;
  winners: ResultsWinner[];
  deliveredCount: number;
  undelivered: ResultsWinner[];
  skipped: ResultsWinner[];
}): string {
  const parts: string[] = [
    `✅ Конкурс «${escapeHtml(params.contestName)}» (ID: ${params.contestId}) завершён.`,
  ];

  parts.push(
    params.winners.length
      ? `🏆 Победители:\n${formatNameList(params.winners)}`
      : 'Победителей нет — конкурс завершён без участников.',
  );

  if (params.winners.length) {
    parts.push(
      `Уведомлений доставлено: ${params.deliveredCount} из ${params.winners.length}.`,
    );
  }

  if (params.undelivered.length) {
    parts.push(
      `⚠️ Не доставлено (вероятно, не запускали бота) — напишите вручную:\n` +
        formatNameList(params.undelivered),
    );
  }

  if (params.skipped.length) {
    parts.push(
      `ℹ️ Без Telegram-аккаунта, уведомить невозможно:\n` +
        formatNameList(params.skipped),
    );
  }

  return parts.join('\n\n');
}
