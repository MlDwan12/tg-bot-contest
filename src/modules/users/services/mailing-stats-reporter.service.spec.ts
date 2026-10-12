import { MailingJobEntity } from '../entities/mailing-jobs.entity';
import { buildMailingStatsPayload } from './mailing-stats-reporter.service';

function job(overrides: Partial<MailingJobEntity>): MailingJobEntity {
  return {
    sentCount: 20406,
    blockedCount: 3900,
    errorCount: 42,
    startedAt: new Date('2026-10-11T09:00:00Z'),
    createdAt: new Date('2026-10-11T09:00:00Z'),
    ...overrides,
  } as MailingJobEntity;
}

describe('buildMailingStatsPayload', () => {
  it('ровно четыре поля контракта, счётчики из mailing_jobs', () => {
    expect(buildMailingStatsPayload(job({}))).toEqual({
      date: '2026-10-11',
      delivered: 20406,
      blocked: 3900,
      errors: 42,
    });
  });

  it('дата — день старта по МСК, а не по UTC', () => {
    // 22:30 UTC 11.10 = 01:30 МСК 12.10
    const payload = buildMailingStatsPayload(
      job({ startedAt: new Date('2026-10-11T22:30:00Z') }),
    );
    expect(payload.date).toBe('2026-10-12');
  });

  it('без startedAt берёт createdAt', () => {
    const payload = buildMailingStatsPayload(
      job({ startedAt: null, createdAt: new Date('2026-10-05T10:00:00Z') }),
    );
    expect(payload.date).toBe('2026-10-05');
  });
});
