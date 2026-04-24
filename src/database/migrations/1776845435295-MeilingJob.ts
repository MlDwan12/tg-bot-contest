import { MigrationInterface, QueryRunner } from 'typeorm';

export class MailingJob1776845435295 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "mailing_jobs" ("id" character varying NOT NULL, "type" character varying(50) NOT NULL, "initiatorUserId" integer, "contestId" integer, "groupId" bigint, "totalRecipients" integer NOT NULL DEFAULT '0', "queuedCount" integer NOT NULL DEFAULT '0', "sentCount" integer NOT NULL DEFAULT '0', "failedCount" integer NOT NULL DEFAULT '0', "skippedCount" integer NOT NULL DEFAULT '0', "deletedCount" integer NOT NULL DEFAULT '0', "deleteFailedCount" integer NOT NULL DEFAULT '0', "status" character varying(50) NOT NULL DEFAULT 'pending', "text" text, "imagePath" text, "buttonText" text, "buttonUrl" text, "startedAt" TIMESTAMP, "finishedAt" TIMESTAMP, "error" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a4b61d716737b5df50341817cce" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "mailing_messages" ADD "sendStatus" character varying(20) NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "mailing_messages" ADD "sendError" text`,
    );
    await queryRunner.query(`ALTER TABLE "mailing_messages" ADD "text" text`);
    await queryRunner.query(
      `ALTER TABLE "mailing_messages" ADD "imagePath" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "mailing_messages" DROP COLUMN "imagePath"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mailing_messages" DROP COLUMN "text"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mailing_messages" DROP COLUMN "sendError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mailing_messages" DROP COLUMN "sendStatus"`,
    );
    await queryRunner.query(`DROP TABLE "mailing_jobs"`);
  }
}
