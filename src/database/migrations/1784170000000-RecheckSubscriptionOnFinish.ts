import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Перепроверка подписки на обязательные каналы перед розыгрышем.
 *
 * Раньше подписка проверялась только в момент участия, и отписавшийся после
 * этого выигрывал наравне со всеми. Теперь перед подведением итогов пул
 * перепроверяется, а результат сохраняется — это же даёт статистику отписок.
 *
 * Существующим конкурсам перепроверка включается (DEFAULT true), а участники
 * получают VALID: до проверки считать кого-либо выбывшим нельзя.
 */
export class RecheckSubscriptionOnFinish1784170000000 implements MigrationInterface {
  name = 'RecheckSubscriptionOnFinish1784170000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."contest_participants_subscriptionstatus_enum" AS ENUM('valid', 'unsubscribed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_participants" ADD "subscriptionStatus" "public"."contest_participants_subscriptionstatus_enum" NOT NULL DEFAULT 'valid'`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_participants" ADD "subscriptionCheckedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "contests" ADD "recheckSubscriptionOnFinish" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "contests" ADD "subscriptionsCheckedAt" TIMESTAMP`,
    );
    // Пул розыгрыша выбирается по (contestId, subscriptionStatus) — без индекса
    // это seq scan по всем участиям конкурса на каждом завершении.
    await queryRunner.query(
      `CREATE INDEX "IDX_contest_participants_contest_subscription" ON "contest_participants" ("contestId", "subscriptionStatus")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_contest_participants_contest_subscription"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contests" DROP COLUMN "subscriptionsCheckedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contests" DROP COLUMN "recheckSubscriptionOnFinish"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_participants" DROP COLUMN "subscriptionCheckedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_participants" DROP COLUMN "subscriptionStatus"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."contest_participants_subscriptionstatus_enum"`,
    );
  }
}
