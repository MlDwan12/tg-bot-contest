import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ш10: подтверждение приза победителем и автодобор.
 *
 * Отдельного «резерва» нет: очередью на замену служит то же перемешивание
 * shuffle(seed, pool), которым определены победители, — оно уже восстановимо
 * из contest_winner_audit (seed + participantUserIds). Поэтому хранить очередь
 * не требуется, и колонок под неё здесь нет.
 *
 * Обратная совместимость: requireWinnerConfirmation по умолчанию false, а
 * status — 'confirmed'. Существующие строки закрываются этим DEFAULT, иначе
 * автодобор запустился бы задним числом по уже завершённым конкурсам.
 */
export class WinnerConfirmation1784260000000 implements MigrationInterface {
  name = 'WinnerConfirmation1784260000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."contest_winners_status_enum" AS ENUM('pending_confirmation', 'confirmed', 'declined', 'expired')`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_winners" ADD "status" "public"."contest_winners_status_enum" NOT NULL DEFAULT 'confirmed'`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_winners" ADD "confirmationDeadline" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_winners" ADD "confirmedAt" TIMESTAMP`,
    );

    await queryRunner.query(
      `ALTER TABLE "contests" ADD "requireWinnerConfirmation" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "contests" ADD "confirmationHours" integer NOT NULL DEFAULT 24`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contests" DROP COLUMN "confirmationHours"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contests" DROP COLUMN "requireWinnerConfirmation"`,
    );

    await queryRunner.query(
      `ALTER TABLE "contest_winners" DROP COLUMN "confirmedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_winners" DROP COLUMN "confirmationDeadline"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_winners" DROP COLUMN "status"`,
    );
    await queryRunner.query(`DROP TYPE "public"."contest_winners_status_enum"`);
  }
}
