import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChannelInviteLink1787121508220 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "channels" ADD "inviteLink" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "inviteLink"`);
  }
}
