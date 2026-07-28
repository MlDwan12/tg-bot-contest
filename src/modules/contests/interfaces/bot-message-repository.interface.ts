import { BotMessageContentType, BotMessageType } from 'src/common/enums/bot';

/**
 * Единый контракт репозитория агрегата BotMessage (таблица bot_messages) —
 * журнал личных сообщений бота пользователю. Сервисы зависят от этой
 * абстракции через токен BOT_MESSAGE_REPOSITORY.
 */
export interface IBotMessageRepository {
  /** Уже есть успешно доставленное сообщение такого типа по этому конкурсу? */
  existsSent(params: {
    contestId: number;
    userId: number;
    type: BotMessageType;
  }): Promise<boolean>;

  /** Успешная отправка: с id доставленного сообщения. */
  recordSent(params: {
    contestId: number;
    userId: number;
    chatId: string;
    telegramMessageId: number;
    type: BotMessageType;
    contentType: BotMessageContentType;
    payload?: Record<string, unknown>;
  }): Promise<void>;

  /**
   * Неудачная отправка: telegramMessageId остаётся null — сообщения нет.
   * Текст ошибки кладём в payload, отдельной колонки под него нет.
   */
  recordFailed(params: {
    contestId: number;
    userId: number;
    chatId: string;
    type: BotMessageType;
    contentType: BotMessageContentType;
    error: string;
  }): Promise<void>;

  /** Сводка доставки по конкурсу — для отчёта администраторам. */
  countByStatus(
    contestId: number,
    type: BotMessageType,
  ): Promise<{ sent: number; failed: number }>;
}
