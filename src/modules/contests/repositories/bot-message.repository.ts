import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BotMessage } from '../entities';
import { IBotMessageRepository } from '../interfaces';
import {
  BotMessageContentType,
  BotMessageStatus,
  BotMessageType,
} from 'src/common/enums/bot';

/**
 * Единый репозиторий агрегата BotMessage. Подключается через токен
 * BOT_MESSAGE_REPOSITORY, сервисы зависят от IBotMessageRepository.
 */
@Injectable()
export class BotMessageRepository implements IBotMessageRepository {
  constructor(
    @InjectRepository(BotMessage)
    private readonly repo: Repository<BotMessage>,
  ) {}

  // ── чтение ──────────────────────────────────────────────────────────────

  async existsSent(params: {
    contestId: number;
    userId: number;
    type: BotMessageType;
  }): Promise<boolean> {
    return this.repo.existsBy({
      contestId: params.contestId,
      userId: params.userId,
      type: params.type,
      status: BotMessageStatus.SENT,
    });
  }

  async findSentMessage(params: {
    contestId: number;
    userId: number;
    type: BotMessageType;
  }): Promise<{ chatId: string; telegramMessageId: number } | null> {
    const row = await this.repo.findOne({
      where: {
        contestId: params.contestId,
        userId: params.userId,
        type: params.type,
        status: BotMessageStatus.SENT,
      },
      // Свежайшее: на одном месте у победителя может быть несколько отправок
      // (уведомление о призе, потом о замене) — редактировать нужно последнюю.
      order: { id: 'DESC' },
    });

    if (!row?.telegramMessageId) return null;

    return {
      chatId: String(row.chatId),
      telegramMessageId: row.telegramMessageId,
    };
  }

  async findUserIdsByStatus(
    contestId: number,
    type: BotMessageType,
    status: BotMessageStatus,
  ): Promise<number[]> {
    const rows = await this.repo.find({
      where: { contestId, type, status },
      select: { userId: true },
    });

    return rows.map((row) => row.userId);
  }

  // ── запись ──────────────────────────────────────────────────────────────

  async recordSent(params: {
    contestId: number;
    userId: number;
    chatId: string;
    telegramMessageId: number;
    type: BotMessageType;
    contentType: BotMessageContentType;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.repo.insert({
      contestId: params.contestId,
      userId: params.userId,
      chatId: Number(params.chatId),
      telegramMessageId: params.telegramMessageId,
      type: params.type,
      contentType: params.contentType,
      status: BotMessageStatus.SENT,
      payload: params.payload,
    });
  }

  async recordFailed(params: {
    contestId: number;
    userId: number;
    chatId: string;
    type: BotMessageType;
    contentType: BotMessageContentType;
    error: string;
  }): Promise<void> {
    await this.repo.insert({
      contestId: params.contestId,
      userId: params.userId,
      chatId: Number(params.chatId),
      telegramMessageId: null,
      type: params.type,
      contentType: params.contentType,
      status: BotMessageStatus.FAILED,
      // Отдельной колонки под ошибку в bot_messages нет — кладём в payload,
      // обрезая: описания Telegram бывают длинными, а колонка jsonb общая.
      payload: { error: params.error.slice(0, 1000) },
    });
  }
}
