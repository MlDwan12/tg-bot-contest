import { Injectable } from '@nestjs/common';
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
    if (existing) throw new Error('Admin with this login already exists');

    const passwordHash = await bcrypt.hash(password, 10);

    return this.userService.create({
      login,
      passwordHash,
      role: UserRole.ADMIN,
    });
  }

  async findById(id: number): Promise<User | null> {
    return this.userService.findOne({ id, role: UserRole.ADMIN });
  }

  async findByLogin(login: string): Promise<User | null> {
    return this.userService.findOne({ login, role: UserRole.ADMIN });
  }
}
