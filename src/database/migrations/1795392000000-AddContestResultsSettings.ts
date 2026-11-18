import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Настройки поста с итогами конкурса: свой текст (шапка над списком
 * победителей) и картинка — нет / из конкурса / своя. Старые конкурсы
 * получают 'none' и пустой текст — итоги уходят как раньше.
 */
export class AddContestResultsSettings1795392000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "contests"
        ADD "resultsText" text,
        ADD "resultsImageMode" varchar(16) NOT NULL DEFAULT 'none',
        ADD "resultsImagePath" varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "contests"
        DROP COLUMN "resultsImagePath",
        DROP COLUMN "resultsImageMode",
        DROP COLUMN "resultsText"
    `);
  }
}
