import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixContestPublication1775027217892 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contest_publications" DROP CONSTRAINT "FK_79f7780241aa795ae526b6f8b6e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_publications" ADD CONSTRAINT "FK_79f7780241aa795ae526b6f8b6e" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contest_publications" DROP CONSTRAINT "FK_79f7780241aa795ae526b6f8b6e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_publications" ADD CONSTRAINT "FK_79f7780241aa795ae526b6f8b6e" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
