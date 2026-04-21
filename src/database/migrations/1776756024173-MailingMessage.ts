import { MigrationInterface, QueryRunner } from 'typeorm';

export class MailingMessage1776756024173 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "mailing_messages" ("id" SERIAL NOT NULL, "mailingJobId" character varying NOT NULL, "userId" integer, "telegramId" bigint NOT NULL, "chatId" bigint NOT NULL, "messageId" integer NOT NULL, "sentAt" TIMESTAMP NOT NULL, "deleteAfter" TIMESTAMP NOT NULL, "deletedAt" TIMESTAMP, "deleteStatus" character varying NOT NULL DEFAULT 'pending', "deleteError" text, CONSTRAINT "PK_78556c504545563513be66f18a4" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "mailing_messages"`);
  }
}
