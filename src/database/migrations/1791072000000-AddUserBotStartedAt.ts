import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserBotStartedAt1791072000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "botStartedAt" TIMESTAMP`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "botStartedAt"`);
  }
}
