import {
  BotMessageContentType,
  BotMessageStatus,
  BotMessageType,
} from 'src/common/enums/bot';

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

  /**
   * Кому уже отправлено (или не отправлено) — для сводки администраторам и для
   * проверки, что все уведомления по конкурсу отработали.
   */
  /**
   * Координаты доставленного уведомления — чтобы отредактировать его позже.
   * Нужны, когда срок подтверждения истёк: у сообщения надо снять кнопки,
   * иначе победитель жмёт по тому, что уже ничего не делает.
   */
  findSentMessage(params: {
    contestId: number;
    userId: number;
    type: BotMessageType;
  }): Promise<{ chatId: string; telegramMessageId: number } | null>;

  findUserIdsByStatus(
    contestId: number,
    type: BotMessageType,
    status: BotMessageStatus,
  ): Promise<number[]>;
}
