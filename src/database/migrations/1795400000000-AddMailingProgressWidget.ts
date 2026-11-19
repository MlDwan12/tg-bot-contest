import { MigrationInterface, QueryRunner } from 'typeorm';

/** id общего виджета прогресса рассылки у админов (null — виджета нет). */
export class AddMailingProgressWidget1795400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "mailing_jobs" ADD "progressWidgetId" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "mailing_jobs" DROP COLUMN "progressWidgetId"`,
    );
  }
}
