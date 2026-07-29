import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScoreLedgerAndDistricts1785304814173 implements MigrationInterface {
  name = 'ScoreLedgerAndDistricts1785304814173';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "district_claims" RENAME COLUMN "spotCount" TO "teamScore"`,
    );
    await queryRunner.query(
      `CREATE TABLE "district_claim_history" ("id" SERIAL NOT NULL, "sigungucode" character varying NOT NULL, "team" character varying(2) NOT NULL, "teamScore" integer NOT NULL, "capturedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_bd73101f3305dbc949e6a704431" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ad769dfe9d95d80e38aee930e6" ON "district_claim_history"  ("sigungucode", "capturedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c46333c014f5a028aadcc98e36" ON "district_claim_history"  ("capturedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "districts" ("id" SERIAL NOT NULL, "sigunguCode" character varying NOT NULL, "nameKo" character varying NOT NULL, "nameEn" character varying NOT NULL, "centerLat" numeric(9,6), "centerLng" numeric(9,6), "foreignVisitorShare" numeric(9,6), "refPeriod" character varying, "source" character varying, "kmaNx" integer, "kmaNy" integer, "scoreWeight" numeric(6,4) NOT NULL DEFAULT '1', CONSTRAINT "PK_972a72ff4e3bea5c7f43a2b98af" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4f39ae67068c8b630b6bdfaf15" ON "districts"  ("sigunguCode") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."score_events_type_enum" AS ENUM('CLAIM_NEW', 'CLAIM_REVISIT', 'DUEL_WIN', 'DUEL_LOSS')`,
    );
    await queryRunner.query(
      `CREATE TABLE "score_events" ("id" SERIAL NOT NULL, "userId" uuid, "team" character varying(2) NOT NULL, "type" "public"."score_events_type_enum" NOT NULL, "personalPoints" integer NOT NULL, "teamPoints" integer NOT NULL DEFAULT '0', "spotId" integer, "duelId" integer, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1b2270cf7ddc638ef13a1424da1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a7f8c7ab04517e7b1ef176c058" ON "score_events"  ("spotId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_98498474d2bd731f2bff3dd00c" ON "score_events"  ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a78bf9e239c1051e58bca5918" ON "score_events"  ("userId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0f2ab4b6c3e8eb7d54dd7ecc97" ON "score_events"  ("team", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "score_events" ADD CONSTRAINT "FK_edefcb46f2c919c035d7419a2ea" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "score_events" ADD CONSTRAINT "FK_a7f8c7ab04517e7b1ef176c0588" FOREIGN KEY ("spotId") REFERENCES "spots"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "score_events" ADD CONSTRAINT "FK_d50997387e350abd9ad682d2175" FOREIGN KEY ("duelId") REFERENCES "duels"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "score_events" DROP CONSTRAINT "FK_d50997387e350abd9ad682d2175"`,
    );
    await queryRunner.query(
      `ALTER TABLE "score_events" DROP CONSTRAINT "FK_a7f8c7ab04517e7b1ef176c0588"`,
    );
    await queryRunner.query(
      `ALTER TABLE "score_events" DROP CONSTRAINT "FK_edefcb46f2c919c035d7419a2ea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f2ab4b6c3e8eb7d54dd7ecc97"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a78bf9e239c1051e58bca5918"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_98498474d2bd731f2bff3dd00c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a7f8c7ab04517e7b1ef176c058"`,
    );
    await queryRunner.query(`DROP TABLE "score_events"`);
    await queryRunner.query(`DROP TYPE "public"."score_events_type_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4f39ae67068c8b630b6bdfaf15"`,
    );
    await queryRunner.query(`DROP TABLE "districts"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c46333c014f5a028aadcc98e36"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ad769dfe9d95d80e38aee930e6"`,
    );
    await queryRunner.query(`DROP TABLE "district_claim_history"`);
    await queryRunner.query(
      `ALTER TABLE "district_claims" RENAME COLUMN "teamScore" TO "spotCount"`,
    );
  }
}
