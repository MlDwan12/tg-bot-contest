import { DataSource } from 'typeorm';
import { Contest } from 'src/modules/contests/entities/contest.entity';
import { ContestParticipation } from 'src/modules/contests/entities/contest-participation.entity';
import { ContestPublication } from 'src/modules/contests/entities/contest-publications.entity';
import { ContestWinner } from 'src/modules/contests/entities/contest-winner.entity';
import { ContestWinnerAudit } from 'src/modules/contests/entities/contest-winner-audit.entity';
import { Channel } from 'src/modules/channels/entities/channel.entity';
import { ContestReadRepository } from 'src/modules/contests/repositories/contest-read.repository';
import { ContestWriteRepository } from 'src/modules/contests/repositories/contest-write.repository';
import { ContestParticipationReadRepository } from 'src/modules/contests/repositories/contest-participate-read.repository';
import { ContestParticipationWriteRepository } from 'src/modules/contests/repositories/contest-participate-write.repository';
import { ContestWinnerReadRepository } from 'src/modules/contests/repositories/contest-winner-read.repository';
import { ContestWinnerWriteRepository } from 'src/modules/contests/repositories/contest-winner-write.repository';
import { ContestWinnerAuditWriteRepository } from 'src/modules/contests/repositories/contest-winner-audit-write.repository';
import { ContestWinnerService } from 'src/modules/contests/services/contest-winner.service';
import { ContestLifecycleService } from 'src/modules/contests/services/contest-lifecycle.service';

/**
 * Собирает НАСТОЯЩИЕ репозитории конкурсов из тест-DataSource — вручную,
 * теми же конструкторами, что использует NestJS DI (но без DI).
 * Это тот же продовый код, только подключённый к тест-базе.
 */
export function buildContestRepos(ds: DataSource) {
  return {
    contestRead: new ContestReadRepository(
      ds.getRepository(Contest),
      ds.getRepository(ContestPublication),
    ),
    contestWrite: new ContestWriteRepository(
      ds.getRepository(Contest),
      ds.getRepository(Channel),
      ds.getRepository(ContestPublication),
      ds,
    ),
    participationRead: new ContestParticipationReadRepository(
      ds.getRepository(ContestParticipation),
    ),
    participationWrite: new ContestParticipationWriteRepository(
      ds.getRepository(ContestParticipation),
      ds,
    ),
    winnerRead: new ContestWinnerReadRepository(
      ds.getRepository(ContestWinner),
    ),
    winnerWrite: new ContestWinnerWriteRepository(
      ds.getRepository(ContestWinner),
    ),
    winnerAudit: new ContestWinnerAuditWriteRepository(
      ds.getRepository(ContestWinnerAudit),
    ),
  };
}

/**
 * Собирает НАСТОЯЩИЙ ContestWinnerService из тест-DataSource — вручную,
 * тем же конструктором, что и NestJS DI (4 репозитория). Это продовая
 * логика розыгрыша/reuse-guard, подключённая к тест-базе.
 */
export function buildWinnerService(ds: DataSource): ContestWinnerService {
  const repos = buildContestRepos(ds);
  return new ContestWinnerService(
    repos.winnerRead,
    repos.winnerWrite,
    repos.participationRead,
    repos.participationWrite,
    repos.winnerAudit,
  );
}

/**
 * Собирает НАСТОЯЩИЙ ContestLifecycleService (завершение/отмена/активация).
 * Реальные: репозитории конкурса/участий + ContestWinnerService + DataSource.
 * Фейки — только внешний мир (очередь публикаций/jobs/publication-service/
 * logger/telegram), т.к. в путях completeContest они либо не вызываются, либо
 * это чистые сайд-эффекты. Возвращаем и repos/winnerService — чтобы тесты
 * могли шпионить за конкретными репозиториями (та же инстанция, что в сервисе).
 */
export function buildLifecycleService(ds: DataSource) {
  const repos = buildContestRepos(ds);
  const winnerService = new ContestWinnerService(
    repos.winnerRead,
    repos.winnerWrite,
    repos.participationRead,
    repos.participationWrite,
    repos.winnerAudit,
  );

  const noop = async () => undefined;
  const fakeQueue = { add: async () => ({ id: 'job' }) } as any;
  const fakeJobs = {} as any;
  const fakePublication = {
    syncPublishedPosts: noop,
    getPublishedPublicationIdsForContest: async () => [],
  } as any;
  const fakeLogger = { log() {}, warn() {}, error() {}, debug() {} } as any;
  const fakeTelegram = {} as any;

  const service = new ContestLifecycleService(
    repos.contestRead,
    repos.contestWrite,
    repos.participationRead,
    fakeQueue,
    fakeJobs,
    winnerService,
    fakePublication,
    fakeLogger,
    ds,
    fakeTelegram,
  );

  return { service, repos, winnerService };
}
