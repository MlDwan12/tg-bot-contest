import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Фиктивный победитель (ник без TG-аккаунта): у него нет строки в `users`.
 * - `userId` становится nullable — реальный победитель ссылается на юзера,
 *   фиктивный держит `NULL`.
 * - `displayUsername` хранит ник, который оператор вписал руками (@ivan_petrov).
 *
 * FK и UNIQUE(contestId, userId) не трогаем: nullable-FK допускает NULL, а два
 * NULL Postgres считает разными — дубли фиктивных отсекаем в коде по нику.
 */
export class AllowFictitiousContestWinner1784073600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contest_winners" ALTER COLUMN "userId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_winners" ADD "displayUsername" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contest_winners" DROP COLUMN "displayUsername"`,
    );
    // Вернуть NOT NULL можно только если фиктивных победителей (userId IS NULL)
    // в таблице не осталось — иначе откат упадёт, и это ожидаемо.
    await queryRunner.query(
      `ALTER TABLE "contest_winners" ALTER COLUMN "userId" SET NOT NULL`,
    );
  }
}
