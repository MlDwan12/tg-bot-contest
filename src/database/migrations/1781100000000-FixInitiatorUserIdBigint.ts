import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixInitiatorUserIdBigint1781100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "mailing_jobs" ALTER COLUMN "initiatorUserId" TYPE bigint`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "mailing_jobs" ALTER COLUMN "initiatorUserId" TYPE integer`,
    );
  }
}
