import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeChannelTelegramIdToBigint1775132743217 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "channels" DROP CONSTRAINT "UQ_5e784a29c519f9afa906b70bcdd"`,
    );
    await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "telegramId"`);
    await queryRunner.query(`ALTER TABLE "channels" ADD "telegramId" bigint`);
    await queryRunner.query(
      `ALTER TABLE "channels" ADD CONSTRAINT "UQ_5e784a29c519f9afa906b70bcdd" UNIQUE ("telegramId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "channels" DROP CONSTRAINT "UQ_5e784a29c519f9afa906b70bcdd"`,
    );
    await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "telegramId"`);
    await queryRunner.query(
      `ALTER TABLE "channels" ADD "telegramId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "channels" ADD CONSTRAINT "UQ_5e784a29c519f9afa906b70bcdd" UNIQUE ("telegramId")`,
    );
  }
}
