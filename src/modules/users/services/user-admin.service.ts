import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { User } from '../entities';
import { UserRole } from 'src/common/enums/user';
import { CreateUserAdmin } from 'src/modules/users/types';

@Injectable()
export class AdminService {
  constructor(private readonly userService: UsersService) {}

  async createAdmin(dto: CreateUserAdmin): Promise<User> {
    const { login, password } = dto;

    const existing = await this.userService.findByLogin(login);
    if (existing) {
      throw new ConflictException('Admin with this login already exists');
    }

    try {
      const passwordHash = await bcrypt.hash(password, 10);

      return await this.userService.create({
        login,
        passwordHash,
        role: UserRole.ADMIN,
      });
    } catch (error) {
      console.error('createAdmin error:', error);
      throw new InternalServerErrorException('Failed to create admin');
    }
  }

  async findById(id: number): Promise<User | null> {
    return this.userService.findOne({ id, role: UserRole.ADMIN });
  }

  async findByLogin(login: string): Promise<User | null> {
    return this.userService.findOne({ login, role: UserRole.ADMIN });
  }

  /**
   * Резолв автора конкурса, созданного через бота: там нет JWT-логина, только
   * telegramId. telegramId уникален на всю таблицу users, поэтому если этот
   * человек уже участвовал в конкурсах как обычный пользователь — повышаем ЕГО
   * ЖЕ строку до ADMIN, а не создаём вторую (упёрлись бы в unique-constraint).
   * Вызывающий обязан сам проверить telegramId по ADMIN_IDS до вызова.
   */
  async findOrCreateByTelegramId(telegramId: string): Promise<User> {
    const admin = await this.userService.findOne({
      telegramId,
      role: UserRole.ADMIN,
    });
    if (admin) {
      return admin;
    }

    const existing = await this.userService.findByTelegramId(telegramId);
    if (existing) {
      return this.userService.save({ ...existing, role: UserRole.ADMIN });
    }

    return this.userService.create({ telegramId, role: UserRole.ADMIN });
  }
}
