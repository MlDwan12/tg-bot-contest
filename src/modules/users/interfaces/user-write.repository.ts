import { User } from '../entities/user.entity';

export interface IUserWriteRepository {
  create(user: Partial<User>): Promise<User>;
  save(user: User): Promise<User>;
  remove(user: User): Promise<void>;
}
