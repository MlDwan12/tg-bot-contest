import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities';
import { Injectable } from '@nestjs/common';
import { IUserWriteRepository } from '../interfaces';

@Injectable()
export class UserWriteRepository implements IUserWriteRepository {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  create(user: Partial<User>): Promise<User> {
    return this.repo.save(this.repo.create(user));
  }

  save(user: User): Promise<User> {
    return this.repo.save(user);
  }

  async remove(user: User): Promise<void> {
    await this.repo.remove(user);
  }

  async update(id: number, data: Partial<User>): Promise<User> {
    await this.repo.update(id, data);
    return await this.repo.findOneByOrFail({ id });
  }
}
