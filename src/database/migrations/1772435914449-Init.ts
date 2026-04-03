import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1772435914449 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."channels_type_enum" AS ENUM('casino', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "channels" ("id" SERIAL NOT NULL, "telegramId" character varying, "telegramUsername" character varying, "name" character varying(100), "isActive" boolean NOT NULL DEFAULT true, "type" "public"."channels_type_enum" NOT NULL DEFAULT 'other', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_5e784a29c519f9afa906b70bcdd" UNIQUE ("telegramId"), CONSTRAINT "UQ_2bc0000276a5030b5d7a0b4e8a7" UNIQUE ("telegramUsername"), CONSTRAINT "PK_bc603823f3f741359c2339389f9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."contest_publications_status_enum" AS ENUM('pending', 'published', 'failed', 'deleted')`,
    );
    await queryRunner.query(
      `CREATE TABLE "contest_publications" ("id" SERIAL NOT NULL, "contestId" integer NOT NULL, "channelId" integer NOT NULL, "chatId" bigint NOT NULL, "telegramMessageId" integer, "status" "public"."contest_publications_status_enum" NOT NULL DEFAULT 'pending', "error" text, "payload" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "publishedAt" TIMESTAMP, CONSTRAINT "UQ_0345d2cf6bd0ac6d28688e7b804" UNIQUE ("contestId", "channelId"), CONSTRAINT "PK_86579dde93732467eb0b9cf079f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."bot_messages_type_enum" AS ENUM('contest_winner', 'contest_reminder', 'system')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."bot_messages_contenttype_enum" AS ENUM('text', 'photo')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."bot_messages_status_enum" AS ENUM('sent', 'failed', 'deleted')`,
    );
    await queryRunner.query(
      `CREATE TABLE "bot_messages" ("id" SERIAL NOT NULL, "telegramMessageId" integer NOT NULL, "chatId" bigint NOT NULL, "userId" integer NOT NULL, "contestId" integer, "type" "public"."bot_messages_type_enum" NOT NULL, "contentType" "public"."bot_messages_contenttype_enum" NOT NULL, "status" "public"."bot_messages_status_enum" NOT NULL DEFAULT 'sent', "payload" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_333da6c5e0aa0eb4d6e8eec1b61" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "contest_winners" ("id" SERIAL NOT NULL, "contestId" integer NOT NULL, "userId" integer NOT NULL, "place" integer NOT NULL, CONSTRAINT "UQ_99f7656bbc7d1687f12f12ab642" UNIQUE ("contestId", "userId"), CONSTRAINT "PK_d834c4b4b12c1a9f72fdbe77560" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."contests_status_enum" AS ENUM('pending', 'active', 'completed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."contests_winnerstrategy_enum" AS ENUM('random', 'manual')`,
    );
    await queryRunner.query(
      `CREATE TABLE "contests" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "description" character varying, "status" "public"."contests_status_enum" NOT NULL, "winnerStrategy" "public"."contests_winnerstrategy_enum" NOT NULL, "prizePlaces" integer NOT NULL, "creatorId" integer NOT NULL, "startDate" TIMESTAMP NOT NULL, "endDate" TIMESTAMP NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0b8012f5cf6f444a52179e1227a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "contest_participants" ("id" SERIAL NOT NULL, "contestId" integer NOT NULL, "userId" integer NOT NULL, "joinedAt" TIMESTAMP NOT NULL DEFAULT now(), "prizePlace" smallint, "isWinner" boolean NOT NULL DEFAULT false, "groupId" bigint, CONSTRAINT "PK_aa049e7b688ddb700cc10895714" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b7da56613692a01ad2712eb49c" ON "contest_participants" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_32fbceaed6401a8b89a4324522" ON "contest_participants" ("contestId", "prizePlace") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1b3269222688e37c3087fbd54b" ON "contest_participants" ("contestId", "userId") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM('user', 'admin')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" SERIAL NOT NULL, "role" "public"."users_role_enum" NOT NULL DEFAULT 'user', "telegramId" character varying, "username" character varying, "firstName" character varying, "lastName" character varying, "login" character varying, "passwordHash" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_df18d17f84763558ac84192c754" UNIQUE ("telegramId"), CONSTRAINT "UQ_2d443082eccd5198f95f2a36e2c" UNIQUE ("login"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "contest_publish_channels" ("contestsId" integer NOT NULL, "channelsId" integer NOT NULL, CONSTRAINT "PK_56c5295bc6b13537a510c7fe694" PRIMARY KEY ("contestsId", "channelsId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7d992e1bdb4981a2fbc7800f9d" ON "contest_publish_channels" ("contestsId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_62c84c5e1578c4b1ed111d8c9c" ON "contest_publish_channels" ("channelsId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "contest_required_channels" ("contestsId" integer NOT NULL, "channelsId" integer NOT NULL, CONSTRAINT "PK_7ab1d88d28c8be649e1e64f0d1f" PRIMARY KEY ("contestsId", "channelsId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ee56d9f8b80e9cfed4096410f4" ON "contest_required_channels" ("contestsId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_af4ae8380f0165195d07d1938b" ON "contest_required_channels" ("channelsId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_publications" ADD CONSTRAINT "FK_c3aabf426db2537451d793e64b9" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_publications" ADD CONSTRAINT "FK_79f7780241aa795ae526b6f8b6e" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "bot_messages" ADD CONSTRAINT "FK_062770a14979f7aa93d0d54aca0" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "bot_messages" ADD CONSTRAINT "FK_3aad46826103b8094062af098a8" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_winners" ADD CONSTRAINT "FK_878c0bec9e76e365f3fecdc620d" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_winners" ADD CONSTRAINT "FK_db74a0a61fa041b5ee2bcdbf4ac" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contests" ADD CONSTRAINT "FK_0aa1119efa2dfffd78fa6c8607f" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_participants" ADD CONSTRAINT "FK_02ac00fdd7fdb807b609c3e92ff" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_participants" ADD CONSTRAINT "FK_b7da56613692a01ad2712eb49cf" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_publish_channels" ADD CONSTRAINT "FK_7d992e1bdb4981a2fbc7800f9d4" FOREIGN KEY ("contestsId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_publish_channels" ADD CONSTRAINT "FK_62c84c5e1578c4b1ed111d8c9cf" FOREIGN KEY ("channelsId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_required_channels" ADD CONSTRAINT "FK_ee56d9f8b80e9cfed4096410f41" FOREIGN KEY ("contestsId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_required_channels" ADD CONSTRAINT "FK_af4ae8380f0165195d07d1938b3" FOREIGN KEY ("channelsId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contest_required_channels" DROP CONSTRAINT "FK_af4ae8380f0165195d07d1938b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_required_channels" DROP CONSTRAINT "FK_ee56d9f8b80e9cfed4096410f41"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_publish_channels" DROP CONSTRAINT "FK_62c84c5e1578c4b1ed111d8c9cf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_publish_channels" DROP CONSTRAINT "FK_7d992e1bdb4981a2fbc7800f9d4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_participants" DROP CONSTRAINT "FK_b7da56613692a01ad2712eb49cf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_participants" DROP CONSTRAINT "FK_02ac00fdd7fdb807b609c3e92ff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contests" DROP CONSTRAINT "FK_0aa1119efa2dfffd78fa6c8607f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_winners" DROP CONSTRAINT "FK_db74a0a61fa041b5ee2bcdbf4ac"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_winners" DROP CONSTRAINT "FK_878c0bec9e76e365f3fecdc620d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bot_messages" DROP CONSTRAINT "FK_3aad46826103b8094062af098a8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bot_messages" DROP CONSTRAINT "FK_062770a14979f7aa93d0d54aca0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_publications" DROP CONSTRAINT "FK_79f7780241aa795ae526b6f8b6e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contest_publications" DROP CONSTRAINT "FK_c3aabf426db2537451d793e64b9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_af4ae8380f0165195d07d1938b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ee56d9f8b80e9cfed4096410f4"`,
    );
    await queryRunner.query(`DROP TABLE "contest_required_channels"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_62c84c5e1578c4b1ed111d8c9c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7d992e1bdb4981a2fbc7800f9d"`,
    );
    await queryRunner.query(`DROP TABLE "contest_publish_channels"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1b3269222688e37c3087fbd54b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_32fbceaed6401a8b89a4324522"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b7da56613692a01ad2712eb49c"`,
    );
    await queryRunner.query(`DROP TABLE "contest_participants"`);
    await queryRunner.query(`DROP TABLE "contests"`);
    await queryRunner.query(
      `DROP TYPE "public"."contests_winnerstrategy_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."contests_status_enum"`);
    await queryRunner.query(`DROP TABLE "contest_winners"`);
    await queryRunner.query(`DROP TABLE "bot_messages"`);
    await queryRunner.query(`DROP TYPE "public"."bot_messages_status_enum"`);
    await queryRunner.query(
      `DROP TYPE "public"."bot_messages_contenttype_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."bot_messages_type_enum"`);
    await queryRunner.query(`DROP TABLE "contest_publications"`);
    await queryRunner.query(
      `DROP TYPE "public"."contest_publications_status_enum"`,
    );
    await queryRunner.query(`DROP TABLE "channels"`);
    await queryRunner.query(`DROP TYPE "public"."channels_type_enum"`);
  }
}
