import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeContest1775038599656 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contests" ADD "buttonText" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "contests" ADD "buttonUrl" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contests" DROP COLUMN "buttonUrl"`);
    await queryRunner.query(`ALTER TABLE "contests" DROP COLUMN "buttonText"`);
  }
}
