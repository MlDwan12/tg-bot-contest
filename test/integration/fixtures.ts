import { DataSource } from 'typeorm';
import { User } from 'src/modules/users/entities/user.entity';
import { Contest } from 'src/modules/contests/entities/contest.entity';
import { ContestParticipation } from 'src/modules/contests/entities/contest-participation.entity';
import { UserRole } from 'src/shared/enums/user';
import { ContestStatus, WinnerStrategy } from 'src/shared/enums/contest';

// Счётчик для уникальных значений (telegramId — unique-колонка).
let seq = 0;
function uniqueSuffix(): string {
  seq += 1;
  return `${Date.now()}_${seq}`;
}

/** Создаёт пользователя. По умолчанию — обычный участник с уникальным telegramId. */
export async function createUser(
  ds: DataSource,
  overrides: Partial<User> = {},
): Promise<User> {
  const repo = ds.getRepository(User);
  const user = repo.create({
    role: UserRole.USER,
    telegramId: uniqueSuffix(),
    ...overrides,
  });
  return repo.save(user);
}

/**
 * Создаёт конкурс. По умолчанию — активный, случайная стратегия, 1 призовое место,
 * идёт «сейчас» (начался час назад, кончится через час).
 */
export async function createContest(
  ds: DataSource,
  creator: User,
  overrides: Partial<Contest> = {},
): Promise<Contest> {
  const repo = ds.getRepository(Contest);
  const now = Date.now();
  const contest = repo.create({
    name: 'Test contest',
    status: ContestStatus.ACTIVE,
    winnerStrategy: WinnerStrategy.RANDOM,
    prizePlaces: 1,
    creatorId: creator.id,
    startDate: new Date(now - 3600_000),
    endDate: new Date(now + 3600_000),
    ...overrides,
  });
  return repo.save(contest);
}

/**
 * Добавляет НОВОГО участника в конкурс: создаёт свежего пользователя и строку
 * участия в contest_participants. Возвращает и пользователя, и участие —
 * удобно для наблюдений (сверить id победителя с id участника).
 */
export async function addParticipant(
  ds: DataSource,
  contestId: number,
): Promise<{ user: User; participation: ContestParticipation }> {
  const user = await createUser(ds);
  const repo = ds.getRepository(ContestParticipation);
  const participation = await repo.save(
    repo.create({ contestId, userId: user.id }),
  );
  return { user, participation };
}
