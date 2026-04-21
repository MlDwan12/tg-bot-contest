import { ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { User } from '../entities';
import { UserRole } from 'src/shared/enums/user';
import { CreateUserAdmin } from 'src/shared/types/users';

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
}
