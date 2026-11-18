import { UserListItemDto } from './user-list-item.dto';

export class UserContestItemDto {
  id: number;
  name: string;
}

// Поля списка + группы/конкурсы: ровно то, что ждёт карточка в админке.
export class UserDetailsDto extends UserListItemDto {
  groups: string[];
  contests: UserContestItemDto[];
}
