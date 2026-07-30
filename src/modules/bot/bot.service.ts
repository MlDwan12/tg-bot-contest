import { Injectable } from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import { Logger } from 'nestjs-pino';
import { InjectBot } from 'nestjs-telegraf';
import { InputMediaPhoto } from 'node_modules/telegraf/typings/core/types/typegram';
import { extname, join } from 'path';
import { Telegraf } from 'telegraf';
/**
 * Минимум, нужный боту для удаления сообщения публикации. Структурно совместим
 * с ContestPublication, но bot НЕ зависит от домена contests (цикл bot↔contests разорван).
 */
interface DeletablePublication {
  id: number;
  telegramMessageId?: number | null;
  channel?: { externalId?: string | null } | null;
}

@Injectable()
export class TelegramService {
  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly logger: Logger,
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

      if (!existsSync(filePath)) {
        throw new Error(`Image file not found: ${dto.photoUrl}`);
      }

      const msg = await this.bot.telegram.sendPhoto(
        dto.chatId,
        { source: createReadStream(filePath) },
        {
          caption: dto.text,
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        },
      );
      return { messageId: msg.message_id };
    }

    // Обычный текст
    const msg = await this.bot.telegram.sendMessage(dto.chatId, dto.text, {
      parse_mode: 'HTML',
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
              parse_mode: 'HTML',
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
              parse_mode: 'HTML',
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
          parse_mode: 'HTML',
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
    buttonText?: string;
    buttonUrl?: string; // если не передать — можно убрать клавиатуру
  }): Promise<void> {
    // уберём клавиатуру полностью

    try {
      if (!dto.buttonText || !dto.buttonUrl) {
        await this.bot.telegram.editMessageReplyMarkup(
          dto.chatId,
          dto.messageId,
          undefined,
          { inline_keyboard: [] },
        );
      } else {
        const replyMarkup = dto.buttonUrl
          ? {
              inline_keyboard: [[{ text: dto.buttonText, url: dto.buttonUrl }]],
            }
          : undefined;

        await this.bot.telegram.editMessageReplyMarkup(
          dto.chatId,
          dto.messageId,
          undefined,
          replyMarkup,
        );
      }
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
    /**
     * Инлайн-кнопки, возвращающие нажатие боту (подтверждение приза), в отличие
     * от buttonUrl, который просто ведёт по ссылке. Заданы — имеют приоритет:
     * в одном ряду вперемешку url и callback не нужны никому из вызывающих.
     */
    callbackButtons?: Array<{ text: string; callbackData: string }>;
  }): Promise<{ messageId: number; chatId: string }> {
    this.logger.debug(
      {
        chatId: dto.chatId,
        hasMedia: !!dto.imagePath,
        hasButton: !!(dto.buttonText && dto.buttonUrl),
      },
      'sendMailingMessage: start',
    );

    const replyMarkup = dto.callbackButtons?.length
      ? {
          inline_keyboard: [
            dto.callbackButtons.map((button) => ({
              text: button.text,
              callback_data: button.callbackData,
            })),
          ],
        }
      : dto.buttonText && dto.buttonUrl
        ? {
            inline_keyboard: [[{ text: dto.buttonText, url: dto.buttonUrl }]],
          }
        : undefined;

    try {
      if (dto.imagePath) {
        const filePath = join(process.cwd(), dto.imagePath);

        this.logger.debug(
          { chatId: dto.chatId, filePath },
          'sendMailingMessage: resolving file',
        );

        if (!existsSync(filePath)) {
          this.logger.error({ chatId: dto.chatId, filePath }, 'Файл не найден');
          throw new Error(`Media file not found: ${dto.imagePath}`);
        }

        const ext = extname(filePath).toLowerCase();

        if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
          this.logger.debug(
            { chatId: dto.chatId, ext },
            'sendMailingMessage: sending photo',
          );

          const msg = await this.bot.telegram.sendPhoto(
            dto.chatId,
            { source: createReadStream(filePath) },
            {
              caption: dto.text,
              parse_mode: 'HTML',
              reply_markup: replyMarkup,
            },
          );

          this.logger.debug(
            { chatId: dto.chatId, messageId: msg.message_id },
            'sendMailingMessage: photo sent',
          );

          return { messageId: msg.message_id, chatId: String(msg.chat.id) };
        }

        if (['.mp4', '.mov'].includes(ext)) {
          this.logger.debug(
            { chatId: dto.chatId, ext },
            'sendMailingMessage: sending video',
          );

          const msg = await this.bot.telegram.sendVideoNote(
            dto.chatId,
            {
              source: createReadStream(filePath),
            },
            {
              // caption: dto.text,
              // parse_mode: 'HTML',
              // message_effect_id: '5104841245755180586',
              reply_markup: replyMarkup,
            },
          );

          this.logger.debug(
            { chatId: dto.chatId, messageId: msg.message_id },
            'sendMailingMessage: video sent',
          );

          return { messageId: msg.message_id, chatId: String(msg.chat.id) };
        }

        this.logger.error(
          { chatId: dto.chatId, ext },
          'Неподдерживаемый тип файла',
        );
        throw new Error(`Unsupported media type: ${ext}`);
      }

      this.logger.debug(
        { chatId: dto.chatId },
        'sendMailingMessage: sending text',
      );

      const msg = await this.bot.telegram.sendMessage(
        dto.chatId,
        dto.text ?? '',
        {
          reply_markup: replyMarkup,
          parse_mode: 'HTML',
        },
      );

      this.logger.debug(
        { chatId: dto.chatId, messageId: msg.message_id },
        'sendMailingMessage: text sent',
      );

      return { messageId: msg.message_id, chatId: String(msg.chat.id) };
    } catch (error: any) {
      this.logger.error(
        { err: error, chatId: dto.chatId, tgResponse: error?.response },
        'sendMailingMessage: Telegram error',
      );
      throw error;
    }
  }

  // Удаляет telegram-сообщения ПЕРЕДАННЫХ публикаций. Данные готовит вызывающий
  // (ContestPublicationService в домене contests), bot их НЕ тянет обратно —
  // так разорван round-trip, державший цикл bot↔contests.
  async deletePublicationMessages(
    publications: DeletablePublication[],
  ): Promise<void> {
    for (const pub of publications) {
      const chatId = pub.channel?.externalId
        ? Number(pub.channel.externalId)
        : undefined;
      const messageId = pub.telegramMessageId;
      if (!messageId || !chatId) continue;

      try {
        await this.bot.telegram.deleteMessage(chatId, messageId);
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

  async checkBotChannelPermissions(chatId: number): Promise<{
    exists: boolean;
    isAdmin: boolean;
    canPost: boolean;
    canEdit: boolean;
    isChannel: boolean;
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
      const isChannel = chat.type === 'channel';

      let canPost = false;
      let canEdit = false;

      if (member.status === 'creator') {
        canPost = true;
        canEdit = true;
      }

      if (member.status === 'administrator') {
        if (isChannel) {
          canPost =
            'can_post_messages' in member ? !!member.can_post_messages : false;
          canEdit =
            'can_edit_messages' in member ? !!member.can_edit_messages : false;
        } else if (chat.type === 'supergroup' || chat.type === 'group') {
          canPost = true;
          canEdit = true;
        }
      }

      return {
        exists: true,
        isAdmin,
        canPost,
        canEdit,
        isChannel,
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
          canPost: false,
          canEdit: false,
          isChannel: false,
        };
      }

      throw error;
    }
  }
  async getUserFromChatMember(chatId: string | number, telegramId: string) {
    const member = await this.bot.telegram.getChatMember(
      chatId,
      Number(telegramId),
    );

    return {
      telegramId: String(member.user.id),
      username: member.user.username,
      firstName: member.user.first_name,
      lastName: member.user.last_name,
      isBot: member.user.is_bot,
      languageCode: member.user.language_code,
      status: member.status,
    };
  }

  /**
   * Снимает inline-кнопки у отправленного сообщения, оставляя текст.
   *
   * Нужно, когда решение принимать поздно: срок подтверждения истёк, приз ушёл
   * следующему. Живые кнопки под таким сообщением вводят в заблуждение —
   * человек жмёт и не понимает, почему ничего не происходит.
   *
   * Сообщение могло быть удалено получателем, поэтому ошибку Telegram здесь
   * считаем нормальным исходом: сняли — хорошо, не смогли — не беда.
   */
  async removeInlineKeyboard(
    chatId: string,
    messageId: number,
  ): Promise<boolean> {
    try {
      await this.bot.telegram.editMessageReplyMarkup(
        chatId,
        messageId,
        undefined,
        undefined,
      );

      return true;
    } catch (error: any) {
      this.logger.debug(
        { chatId, messageId, tg: error?.response?.description },
        'removeInlineKeyboard: не удалось снять кнопки',
      );

      return false;
    }
  }

  async deleteMessage(chatId: string, messageId: number): Promise<void> {
    await this.bot.telegram.deleteMessage(Number(chatId), messageId);
  }
}
