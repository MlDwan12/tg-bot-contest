import { formatInTimeZone } from 'date-fns-tz';
import { escapeHtml } from './contest-results-text.util';
import { getAppTimeZone } from 'src/common/helpers/app-timezone.helper';

/**
 * Текст личного уведомления победителя.
 *
 * Название конкурса здесь экранируется, хотя в посте канала — нет. В посте
 * название и описание сами по себе являются контентом оператора, и разметка в
 * них намеренно допустима. Здесь же название подставляется в НАШ шаблон: не
 * закрытый оператором тег сломал бы всё сообщение целиком (Telegram ответит
 * 400, и уведомление не уйдёт ни одному победителю).
 */
export function buildWinnerNotificationText(params: {
  contestName: string;
  place: number;
  /** Задан — к тексту добавляется просьба подтвердить приз до этого момента. */
  confirmationDeadline?: Date | null;
  /** Срок в часах — показываем рядом с датой, чтобы не зависеть от пояса. */
  confirmationHours?: number;
}): string {
  const medals = ['🥇', '🥈', '🥉'];
  const medal =
    params.place >= 1 && params.place <= medals.length
      ? `${medals[params.place - 1]} `
      : '';

  const base =
    `${medal}Поздравляем! Вы заняли ${params.place} место ` +
    `в конкурсе «${escapeHtml(params.contestName)}».`;

  if (!params.confirmationDeadline) return base;

  // Срок называем прямо в тексте: без него кнопка выглядит необязательной, а
  // молчание стоит победителю приза.
  //
  // Формат двойной — относительный срок и абсолютная дата. Часовой пояс
  // победителя нам неизвестен: Bot API его не отдаёт (в from только id, имя и
  // language_code, а по нему пояс не восстановить — «ru» это и Калининград, и
  // Камчатка). Поэтому «в течение N часов» понятно всем без пересчёта, а к
  // дате обязательно пишем смещение, иначе москвич и новосибирец прочитают
  // одно и то же число по-разному.
  const relative = params.confirmationHours
    ? `в течение ${pluralizeHours(params.confirmationHours)} — `
    : '';

  return (
    `${base}\n\nПодтвердите получение приза ${relative}до ` +
    `${formatConfirmationDeadline(params.confirmationDeadline)}. ` +
    `Если не ответить, приз перейдёт следующему участнику.`
  );
}

/** Дата в часовом поясе приложения + явное смещение, напр. «GMT+3». */
function formatConfirmationDeadline(deadline: Date): string {
  return formatInTimeZone(deadline, getAppTimeZone(), 'dd.MM.yyyy HH:mm (zzz)');
}

/**
 * «в течение» требует родительного падежа, а он здесь даёт всего две формы:
 * «1 часа» и «2/5/24 часов». Обычной тройки склонений не нужно.
 */
function pluralizeHours(hours: number): string {
  const isSingular = hours % 10 === 1 && hours % 100 !== 11;

  return `${hours} ${isSingular ? 'часа' : 'часов'}`;
}
