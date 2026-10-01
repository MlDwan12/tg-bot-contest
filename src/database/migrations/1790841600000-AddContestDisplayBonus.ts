import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContestDisplayBonus1790841600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contests" ADD "displayBonus" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contests" DROP COLUMN "displayBonus"`,
    );
  }
}
