import { DataSource } from 'typeorm';
import { Contest } from 'src/modules/contests/entities/contest.entity';
import { ContestParticipation } from 'src/modules/contests/entities/contest-participation.entity';
import { ContestPublication } from 'src/modules/contests/entities/contest-publications.entity';
import { ContestWinner } from 'src/modules/contests/entities/contest-winner.entity';
import { ContestWinnerAudit } from 'src/modules/contests/entities/contest-winner-audit.entity';
import { Channel } from 'src/modules/channels/entities/channel.entity';
import { ContestRepository } from 'src/modules/contests/repositories/contest.repository';
import { ContestParticipationRepository } from 'src/modules/contests/repositories/contest-participate.repository';
import { ContestWinnerRepository } from 'src/modules/contests/repositories/contest-winner.repository';
import { ContestWinnerAuditRepository } from 'src/modules/contests/repositories/contest-winner-audit.repository';
import { ContestWinnerService } from 'src/modules/contests/services/contest-winner.service';
import { ContestLifecycleService } from 'src/modules/contests/services/contest-lifecycle.service';

/**
 * Собирает НАСТОЯЩИЕ репозитории конкурсов из тест-DataSource — вручную,
 * теми же конструкторами, что использует NestJS DI (но без DI).
 * Это тот же продовый код, только подключённый к тест-базе.
 */
export function buildContestRepos(ds: DataSource) {
  return {
    // Фаза 9: единый репозиторий агрегата Contest (слиты read+write).
    contest: new ContestRepository(
      ds.getRepository(Contest),
      ds.getRepository(ContestPublication),
      ds.getRepository(Channel),
      ds,
    ),
    // Фаза 9: единый репозиторий агрегата ContestParticipation (слиты read+write).
    participation: new ContestParticipationRepository(
      ds.getRepository(ContestParticipation),
      ds,
    ),
    // Фаза 9: единый репозиторий агрегата ContestWinner (слиты read+write).
    winner: new ContestWinnerRepository(ds.getRepository(ContestWinner)),
    winnerAudit: new ContestWinnerAuditRepository(
      ds.getRepository(ContestWinnerAudit),
    ),
  };
}

/**
 * Собирает НАСТОЯЩИЙ ContestWinnerService из тест-DataSource — вручную,
 * тем же конструктором, что и NestJS DI (3 репозитория). Это продовая
 * логика розыгрыша/reuse-guard, подключённая к тест-базе.
 */
export function buildWinnerService(ds: DataSource): ContestWinnerService {
  const repos = buildContestRepos(ds);
  return new ContestWinnerService(
    repos.winner,
    repos.participation,
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
    repos.winner,
    repos.participation,
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
  // Уведомления победителей — внешний сайд-эффект (очередь + Telegram),
  // в путях completeContest проверяется не он, а розыгрыш и статусы.
  const fakeWinnerNotify = {
    enqueueWinnerNotifications: async () => ({ queued: 0, skipped: 0 }),
  } as any;
  // Перепроверка подписок — отдельная фаза с походами в Telegram. В тестах
  // завершения её выключаем: needsRecheck=false воспроизводит конкурс без
  // обязательных каналов, то есть прежний прямой путь к розыгрышу.
  const fakeSubscriptionRecheck = { needsRecheck: () => false } as any;

  const service = new ContestLifecycleService(
    repos.contest,
    repos.participation,
    fakeQueue,
    fakeJobs,
    winnerService,
    fakeWinnerNotify,
    fakeSubscriptionRecheck,
    fakePublication,
    fakeLogger,
    ds,
    fakeTelegram,
  );

  return { service, repos, winnerService };
}
