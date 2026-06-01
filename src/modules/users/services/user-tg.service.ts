import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from '../entities';
import { UserRole } from 'src/shared/enums/user';
import { TelegramService } from 'src/modules/bot/bot.service';

@Injectable()
export class TelegramUserService {
  constructor(
    private readonly userService: UsersService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  async ensureUser(tgData: {
    telegramId: string;
    groupId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
  }): Promise<User> {
    let user = await this.userService.findByTelegramId(tgData.telegramId);

    if (!user) {
      const tgInfo = await this.telegramService.getUserFromChatMember(
        tgData.groupId,
        tgData.telegramId,
      );

      user = await this.userService.create({
        telegramId: tgData.telegramId,
        username: tgInfo.username,
        firstName: tgInfo.firstName,
        lastName: tgInfo.lastName,
      });

      return user;
    }
    //TODO: update user data if changed
    // const needUpdate =
    //   user.username !== tgData.username ||
    //   user.firstName !== tgData.firstName ||
    //   user.lastName !== tgData.lastName;

    // if (needUpdate) {
    //   user = await this.userService.(user.id, {
    //     username: tgData.username,
    //     firstName: tgData.firstName,
    //     lastName: tgData.lastName,
    //   });
    // }

    return user;
  }

  async findByTelegramId(telegramId: string): Promise<User | null> {
    return this.userService.findByTelegramId(telegramId);
  }

  async findById(id: number): Promise<User | null> {
    return this.userService.findOne({ id, role: UserRole.USER });
  }
}
