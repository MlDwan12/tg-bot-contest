import { UserDetailsDto } from '../dto/get-user-details.dto';
import { UserListItemDto } from '../dto/user-list-item.dto';
import { User } from '../entities/user.entity';

export interface IUserReadRepository {
  findById(id: number): Promise<User | null>;
  findByLogin(login: string): Promise<User | null>;
  findByTelegramId(telegramId: string): Promise<User | null>;
  findAllUsersWithParticipationCount(params: {
    skip: number;
    take: number;
  }): Promise<[UserListItemDto[], number]>;
  findUserDetailsById(id: number): Promise<UserDetailsDto | null>;
}
