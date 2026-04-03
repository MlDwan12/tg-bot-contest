export class UserContestItemDto {
  id: number;
  name: string;
}

export class UserDetailsDto {
  groups: string[];
  contests: UserContestItemDto[];
}
