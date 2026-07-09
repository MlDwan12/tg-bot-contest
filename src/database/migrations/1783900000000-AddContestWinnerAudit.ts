import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContestWinnerAudit1783900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "contest_winner_audit" (
        "id" SERIAL NOT NULL,
        "contestId" integer NOT NULL,
        "strategy" character varying NOT NULL,
        "prizePlaces" integer NOT NULL,
        "winnerUserIds" jsonb NOT NULL,
        "seed" character varying,
        "algorithm" character varying,
        "participantUserIds" jsonb,
        "assignedByUserId" integer,
        "note" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_contest_winner_audit" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_contest_winner_audit_contestId"
      ON "contest_winner_audit" ("contestId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_contest_winner_audit_contestId"`,
    );
    await queryRunner.query(`DROP TABLE "contest_winner_audit"`);
  }
}
