import { Injectable } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from '../entities';
import { UserRole } from 'src/shared/enums/user';

@Injectable()
export class TelegramUserService {
  constructor(private readonly userService: UsersService) {}

  async ensureUser(tgData: {
    telegramId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
  }) {
    let user = await this.userService.findByTelegramId(tgData.telegramId);

    if (!user) {
      user = await this.userService.create({
        telegramId: tgData.telegramId,
        username: tgData.username,
        firstName: tgData.firstName,
        lastName: tgData.lastName,
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
