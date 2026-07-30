import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Готовим Channel под несколько платформ (сейчас MAX, задел под VK):
 * telegramId/telegramUsername → platform + externalId/externalUsername.
 * Значение platform enum расширяем отдельной миграцией, когда появится
 * реальная вторая платформа — заводить неиспользуемые варианты заранее смысла нет.
 */
export class ChannelPlatform1785396000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."channels_platform_enum" AS ENUM('telegram')`,
    );
    await queryRunner.query(
      `ALTER TABLE "channels" ADD "platform" "public"."channels_platform_enum" NOT NULL DEFAULT 'telegram'`,
    );
    await queryRunner.query(
      `ALTER TABLE "channels" ADD "externalId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "channels" ADD "externalUsername" character varying`,
    );

    await queryRunner.query(
      `UPDATE "channels" SET "externalId" = "telegramId"::text, "externalUsername" = "telegramUsername"`,
    );

    await queryRunner.query(
      `ALTER TABLE "channels" DROP CONSTRAINT "UQ_5e784a29c519f9afa906b70bcdd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channels" DROP CONSTRAINT "UQ_2bc0000276a5030b5d7a0b4e8a7"`,
    );
    await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "telegramId"`);
    await queryRunner.query(
      `ALTER TABLE "channels" DROP COLUMN "telegramUsername"`,
    );

    await queryRunner.query(
      `ALTER TABLE "channels" ADD CONSTRAINT "UQ_channels_platform_externalId" UNIQUE ("platform", "externalId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "channels" DROP CONSTRAINT "UQ_channels_platform_externalId"`,
    );

    await queryRunner.query(`ALTER TABLE "channels" ADD "telegramId" bigint`);
    await queryRunner.query(
      `ALTER TABLE "channels" ADD "telegramUsername" character varying`,
    );
    await queryRunner.query(
      `UPDATE "channels" SET "telegramId" = "externalId"::bigint, "telegramUsername" = "externalUsername" WHERE "platform" = 'telegram'`,
    );
    await queryRunner.query(
      `ALTER TABLE "channels" ADD CONSTRAINT "UQ_5e784a29c519f9afa906b70bcdd" UNIQUE ("telegramId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "channels" ADD CONSTRAINT "UQ_2bc0000276a5030b5d7a0b4e8a7" UNIQUE ("telegramUsername")`,
    );

    await queryRunner.query(
      `ALTER TABLE "channels" DROP COLUMN "externalUsername"`,
    );
    await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "externalId"`);
    await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "platform"`);
    await queryRunner.query(`DROP TYPE "public"."channels_platform_enum"`);
  }
}
