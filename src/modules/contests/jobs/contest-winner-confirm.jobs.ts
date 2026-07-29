/**
 * Имена и данные джобов очереди contest-winner-confirm.
 *
 * Вынесены из процессора намеренно: процессор инжектит
 * ContestWinnerNotifyService, а тот ставит джобы дедлайна. Если константы жили
 * бы в процессоре, импорты замкнулись бы в круг, и на момент вычисления
 * декоратора класс сервиса оказывался бы undefined — Nest падал с «can't
 * resolve dependencies ... at index [2]». Файл без зависимостей круг разрывает.
 */

/** Истёк срок подтверждения приза. */
export const CONFIRMATION_DEADLINE_JOB = 'confirmation-deadline';

export interface ConfirmationDeadlineJobData {
  contestId: number;
  winnerId: number;
  place: number;
}

/**
 * Место освободилось по ЯВНОМУ отказу. Отдельный джоб, а не работа прямо в
 * обработчике кнопки: победитель не должен ждать похода в Telegram за
 * подпиской кандидата, пока у него крутятся «часики» на кнопке.
 */
export const PLACE_VACATED_JOB = 'place-vacated';

export interface PlaceVacatedJobData {
  contestId: number;
  place: number;
}
