import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddColumnInContestPublication1772438125688 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contest_publications" ADD "attempts" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_publications" ADD "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contest_publications" DROP COLUMN "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_publications" DROP COLUMN "attempts"`,
    );
  }
}
