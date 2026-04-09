import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import { Logger } from 'nestjs-pino';
import { InjectBot } from 'nestjs-telegraf';
import { InputMediaPhoto } from 'node_modules/telegraf/typings/core/types/typegram';
import { extname, join } from 'path';
import { Telegraf } from 'telegraf';
import { ContestsService } from '../contests/services/contests.service';

@Injectable()
export class TelegramService {
  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly logger: Logger,
    @Inject(forwardRef(() => ContestsService))
    private readonly contestsService: ContestsService,
  ) {}

  async checkBotAdmin(chatId: number): Promise<{
    exists: boolean;
    isAdmin: boolean;
    chat?: {
      id: number;
      title?: string;
      username?: string;
      type: string;
    };
  }> {
    try {
      const botInfo = await this.bot.telegram.getMe();

      const [member, chat] = await Promise.all([
        this.bot.telegram.getChatMember(chatId, botInfo.id),
        this.bot.telegram.getChat(chatId),
      ]);

      const isAdmin =
        member.status === 'administrator' || member.status === 'creator';

      const title = 'title' in chat ? chat.title : undefined;
      const username = 'username' in chat ? chat.username : undefined;

      return {
        exists: true,
        isAdmin,
        chat: {
          id: chat.id,
          title,
          username,
          type: chat.type,
        },
      };
    } catch (error: any) {
      if (
        error?.response?.error_code === 403 ||
        error?.response?.error_code === 400
      ) {
        return {
          exists: false,
          isAdmin: false,
        };
      }

      throw error;
    }
  }

  async sendContestMessage(dto: {
    chatId: string;
    text: string;
    buttonText: string;
    buttonUrl: string;
    photoUrl?: string;
  }): Promise<{ messageId: number }> {
    const replyMarkup = {
      inline_keyboard: [[{ text: dto.buttonText, url: dto.buttonUrl }]],
    };

    // Если нужен фото-пост — можно отправлять фото
    if (dto.photoUrl) {
      const filePath = join(process.cwd(), dto.photoUrl);

      const msg = await this.bot.telegram.sendPhoto(
        dto.chatId,
        { source: createReadStream(filePath) },
        {
          caption: dto.text,
          reply_markup: replyMarkup,
        },
      );
      return { messageId: msg.message_id };
    }

    // Обычный текст
    const msg = await this.bot.telegram.sendMessage(dto.chatId, dto.text, {
      reply_markup: replyMarkup,
    });

    return { messageId: msg.message_id };
  }

  async updateContestPublishedMessage(dto: {
    chatId: string;
    messageId: number;
    text: string;
    buttonText: string;
    buttonUrl: string;
    photoUrl?: string;
  }): Promise<void> {
    const replyMarkup = {
      inline_keyboard: [[{ text: dto.buttonText, url: dto.buttonUrl }]],
    };

    try {
      if (dto.photoUrl) {
        const filePath = join(process.cwd(), dto.photoUrl);

        if (!existsSync(filePath)) {
          throw new Error(`Image file not found: ${dto.photoUrl}`);
        }

        try {
          await this.bot.telegram.editMessageMedia(
            dto.chatId,
            dto.messageId,
            undefined,
            {
              type: 'photo',
              media: { source: createReadStream(filePath) },
              caption: dto.text,
            } as InputMediaPhoto,
            {
              reply_markup: replyMarkup,
            },
          );
          return;
        } catch {
          await this.bot.telegram.editMessageCaption(
            dto.chatId,
            dto.messageId,
            undefined,
            dto.text,
            {
              reply_markup: replyMarkup,
            },
          );
          return;
        }
      }

      await this.bot.telegram.editMessageText(
        dto.chatId,
        dto.messageId,
        undefined,
        dto.text,
        {
          reply_markup: replyMarkup,
        },
      );
    } catch (error: any) {
      const code = error?.response?.error_code;
      const description = error?.response?.description;

      if (
        code === 400 &&
        typeof description === 'string' &&
        (description.includes('message is not modified') ||
          description.includes('message to edit not found') ||
          description.includes('message can not be edited'))
      ) {
        return;
      }

      if (code === 403) return;

      throw error;
    }
  }

  async updateContestMessageButton(dto: {
    chatId: string;
    messageId: number;
    buttonText: string;
    buttonUrl?: string; // если не передать — можно убрать клавиатуру
  }): Promise<void> {
    const replyMarkup = dto.buttonUrl
      ? {
          inline_keyboard: [[{ text: dto.buttonText, url: dto.buttonUrl }]],
        }
      : undefined; // уберём клавиатуру полностью

    try {
      await this.bot.telegram.editMessageReplyMarkup(
        dto.chatId,
        dto.messageId,
        undefined,
        replyMarkup,
      );
    } catch (error: any) {
      const code = error?.response?.error_code;

      // 400/403 сообщение нельзя редактировать / нет прав / бот удалён.
      // Это перманентно — просто не ретраим бесконечно
      if (code === 400 || code === 403) return;

      throw error;
    }
  }

  async sendMailingMessage(dto: {
    chatId: string;
    text?: string;
    imagePath?: string;
    buttonText?: string;
    buttonUrl?: string;
  }): Promise<{ messageId: number }> {
    this.logger.log(
      `sendMailingMessage: chatId=${dto.chatId}, hasMedia=${!!dto.imagePath}, hasButton=${!!dto.buttonText && !!dto.buttonUrl}`,
    );

    if (dto.buttonText || dto.buttonUrl) {
      this.logger.log(
        `Кнопка: text=${dto.buttonText ?? '-'}, url=${dto.buttonUrl ?? '-'}`,
      );
    }

    const replyMarkup =
      dto.buttonText && dto.buttonUrl
        ? {
            inline_keyboard: [[{ text: dto.buttonText, url: dto.buttonUrl }]],
          }
        : undefined;

    try {
      if (dto.imagePath) {
        const filePath = join(process.cwd(), dto.imagePath);

        this.logger.log(`Путь к файлу: ${filePath}`);

        if (!existsSync(filePath)) {
          this.logger.error(`Файл не найден: ${filePath}`);
          throw new Error(`Media file not found: ${dto.imagePath}`);
        }

        const ext = extname(filePath).toLowerCase();
        this.logger.log(`Тип файла: ${ext}`);

        if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
          this.logger.log(`Отправка фото: chatId=${dto.chatId}`);

          const msg = await this.bot.telegram.sendPhoto(
            dto.chatId,
            { source: createReadStream(filePath) },
            {
              caption: dto.text,
              reply_markup: replyMarkup,
            },
          );

          this.logger.log(
            `Фото отправлено успешно: chatId=${dto.chatId}, messageId=${msg.message_id}`,
          );

          return { messageId: msg.message_id };
        }

        if (['.mp4', '.mov', '.webm'].includes(ext)) {
          this.logger.log(`Отправка видео: chatId=${dto.chatId}`);

          const msg = await this.bot.telegram.sendVideo(
            dto.chatId,
            { source: createReadStream(filePath) },
            {
              caption: dto.text,
              reply_markup: replyMarkup,
            },
          );

          this.logger.log(
            `Видео отправлено успешно: chatId=${dto.chatId}, messageId=${msg.message_id}`,
          );

          return { messageId: msg.message_id };
        }

        this.logger.error(`Неподдерживаемый тип файла: ${ext}`);
        throw new Error(`Unsupported media type: ${ext}`);
      }

      this.logger.log(`Отправка текстового сообщения: chatId=${dto.chatId}`);

      const msg = await this.bot.telegram.sendMessage(
        dto.chatId,
        dto.text ?? '',
        {
          reply_markup: replyMarkup,
        },
      );

      this.logger.log(
        `Сообщение отправлено: chatId=${dto.chatId}, messageId=${msg.message_id}`,
      );

      return { messageId: msg.message_id };
    } catch (error: any) {
      this.logger.error(
        `Ошибка при отправке в Telegram: chatId=${dto.chatId}, error=${error?.message}`,
        error?.stack,
      );

      if (error?.response) {
        this.logger.error(
          `Telegram response: ${JSON.stringify(error.response)}`,
        );
      }

      throw error;
    }
  }

  async deleteContestPublications(contestId: number): Promise<void> {
    const publications =
      await this.contestsService.getPublicationsByContestId(contestId);

    for (const pub of publications) {
      if (!pub.telegramMessageId || !pub.channel?.telegramId) continue;

      try {
        await this.bot.telegram.deleteMessage(
          pub.channel.telegramId,
          pub.telegramMessageId,
        );
      } catch (e) {
        this.logger.warn(
          { pubId: pub.id, error: e.message },
          'Failed to delete Telegram message',
        );
      }
    }
  }

  async checkUserInChannels(
    telegramId: string,
    channelTelegramIds: number[],
  ): Promise<{ passed: boolean; missingChannels: number[] }> {
    const missingChannels: number[] = [];

    await Promise.all(
      channelTelegramIds.map(async (channelId) => {
        try {
          const member = await this.bot.telegram.getChatMember(
            channelId,
            Number(telegramId),
          );
          const isSubscribed = ['member', 'administrator', 'creator'].includes(
            member.status,
          );
          if (!isSubscribed) missingChannels.push(channelId);
        } catch {
          missingChannels.push(channelId);
        }
      }),
    );

    return { passed: missingChannels.length === 0, missingChannels };
  }
}
