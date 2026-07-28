import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * bot_messages ведёт журнал личных сообщений бота. Неудачную отправку тоже
 * нужно записывать (бот не может писать первым тому, кто не запускал /start —
 * такие победители остаются неуведомлёнными, и это важно видеть), а у неё нет
 * telegramMessageId. Разрешаем колонке быть NULL.
 */
export class AllowFailedBotMessage1784160000000 implements MigrationInterface {
  name = 'AllowFailedBotMessage1784160000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bot_messages" ALTER COLUMN "telegramMessageId" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Строки без telegramMessageId (неудачные отправки) вернуть в NOT NULL
    // нельзя — удаляем их, иначе ALTER упадёт.
    await queryRunner.query(
      `DELETE FROM "bot_messages" WHERE "telegramMessageId" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "bot_messages" ALTER COLUMN "telegramMessageId" SET NOT NULL`,
    );
  }
}
