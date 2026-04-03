import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixContestStatus1775128399243 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."contests_status_enum" RENAME TO "contests_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."contests_status_enum" AS ENUM('pending', 'active', 'completed', 'cancelled', 'draft')`,
    );
    await queryRunner.query(
      `ALTER TABLE "contests" ALTER COLUMN "status" TYPE "public"."contests_status_enum" USING "status"::"text"::"public"."contests_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."contests_status_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."contests_status_enum_old" AS ENUM('pending', 'active', 'completed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "contests" ALTER COLUMN "status" TYPE "public"."contests_status_enum_old" USING "status"::"text"::"public"."contests_status_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."contests_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."contests_status_enum_old" RENAME TO "contests_status_enum"`,
    );
  }
}
