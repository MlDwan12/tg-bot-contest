import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixContest1775039588066 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contests" DROP COLUMN IF EXISTS "buttonUrl"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contests" ADD "buttonUrl" character varying`,
    );
  }
}
