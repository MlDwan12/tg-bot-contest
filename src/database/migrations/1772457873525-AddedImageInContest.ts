import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddedImageInContest1772457873525 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contests" ADD "imagePath" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contests" DROP COLUMN "imagePath"`);
  }
}
