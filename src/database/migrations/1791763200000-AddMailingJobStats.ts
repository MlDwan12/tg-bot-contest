import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Разбивка ошибок рассылки (blocked / прочие) и отметка об отправке отчёта
 * во внешний API.
 *
 * Старые рассылки уже отчитаны вручную — помечаем их statsReportedAt, иначе
 * первый же крон отправит их повторно и перезапишет данные за прошлые даты.
 * blockedCount для них восстанавливаем из sendError там, где строки ещё живы
 * (failed-строки чистятся раз в неделю), остаток failedCount — в errorCount.
 */
export class AddMailingJobStats1791763200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "mailing_jobs"
        ADD "blockedCount" integer NOT NULL DEFAULT 0,
        ADD "errorCount" integer NOT NULL DEFAULT 0,
        ADD "statsReportedAt" TIMESTAMP
    `);

    await queryRunner.query(`UPDATE "mailing_jobs" SET "statsReportedAt" = now()`);

    await queryRunner.query(`
      UPDATE "mailing_jobs" j
      SET "blockedCount" = b.cnt
      FROM (
        SELECT "mailingJobId", count(*)::int AS cnt
        FROM "mailing_messages"
        WHERE "sendStatus" = 'failed'
          AND ("sendError" ILIKE '%bot was blocked by the user%'
            OR "sendError" ILIKE '%user is deactivated%')
        GROUP BY "mailingJobId"
      ) b
      WHERE b."mailingJobId" = j."id"
    `);

    await queryRunner.query(`
      UPDATE "mailing_jobs"
      SET "errorCount" = GREATEST("failedCount" - "blockedCount", 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "mailing_jobs"
        DROP COLUMN "statsReportedAt",
        DROP COLUMN "errorCount",
        DROP COLUMN "blockedCount"
    `);
  }
}
