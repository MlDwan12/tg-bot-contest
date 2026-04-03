import { MigrationInterface, QueryRunner } from "typeorm";

export class RENAMEME1775136372411 implements MigrationInterface {
    name = 'RENAMEME1775136372411'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."contest_publications_status_enum" RENAME TO "contest_publications_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."contest_publications_status_enum" AS ENUM('pending', 'processing', 'published', 'failed', 'cancelled')`);
        await queryRunner.query(`ALTER TABLE "contest_publications" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "contest_publications" ALTER COLUMN "status" TYPE "public"."contest_publications_status_enum" USING "status"::"text"::"public"."contest_publications_status_enum"`);
        await queryRunner.query(`ALTER TABLE "contest_publications" ALTER COLUMN "status" SET DEFAULT 'pending'`);
        await queryRunner.query(`DROP TYPE "public"."contest_publications_status_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."contest_publications_status_enum_old" AS ENUM('pending', 'processing', 'published', 'failed')`);
        await queryRunner.query(`ALTER TABLE "contest_publications" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "contest_publications" ALTER COLUMN "status" TYPE "public"."contest_publications_status_enum_old" USING "status"::"text"::"public"."contest_publications_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "contest_publications" ALTER COLUMN "status" SET DEFAULT 'pending'`);
        await queryRunner.query(`DROP TYPE "public"."contest_publications_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."contest_publications_status_enum_old" RENAME TO "contest_publications_status_enum"`);
    }

}
