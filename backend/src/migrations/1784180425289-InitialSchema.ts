import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1784180425289 implements MigrationInterface {
  name = 'InitialSchema1784180425289';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // synchronize는 uuid-ossp를 자동 설치하지만 마이그레이션은 아니므로 명시한다.
    // (users.id의 uuid_generate_v4() 기본값에 필요)
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    // 방문 인증(ST_DWithin)·결투 조우 검증 등 런타임 쿼리에 필요
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
    await queryRunner.query(
      `CREATE TABLE "district_claims" ("id" SERIAL NOT NULL, "sigungucode" character varying NOT NULL, "team" character varying(2) NOT NULL, "spotCount" integer NOT NULL, "calculatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5e25601e9104d9a9475e4354307" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f9e7889a7513289576a19df5d8" ON "district_claims"  ("sigungucode") `,
    );
    await queryRunner.query(
      `CREATE TABLE "spots" ("id" SERIAL NOT NULL, "contentId" character varying NOT NULL, "title" character varying NOT NULL, "addr1" character varying, "mapX" numeric(13,10), "mapY" numeric(13,10), "firstimage" character varying, "contenttypeid" character varying, "areacode" character varying, "sigungucode" character varying, "overview" text, "usetime" character varying, "homepage" character varying, CONSTRAINT "UQ_509e7b66d1e2daec8206e170554" UNIQUE ("contentId"), CONSTRAINT "PK_cc8c0341ef60619746e42815cf4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "firebaseUid" character varying NOT NULL, "email" character varying NOT NULL, "nickname" character varying NOT NULL, "nationality" character varying(2) NOT NULL, "team" character varying(2) NOT NULL, "score" integer NOT NULL DEFAULT 0, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_e621f267079194e5428e19af2f3" UNIQUE ("firebaseUid"), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "spot_claims" ("id" SERIAL NOT NULL, "spotId" integer NOT NULL, "team" character varying(2) NOT NULL, "userId" uuid, "claimedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c7f818ece5c45bcf1857f3069f2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_099a429fad3780868bb1de1643" ON "spot_claims"  ("spotId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "spot_claims" ADD CONSTRAINT "FK_099a429fad3780868bb1de16430" FOREIGN KEY ("spotId") REFERENCES "spots"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "spot_claims" ADD CONSTRAINT "FK_7dc6d493ed47840cb1131b9e376" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."duels_status_enum" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'COMPLETED', 'VOID')`,
    );
    await queryRunner.query(
      `CREATE TABLE "duels" ("id" SERIAL NOT NULL, "challengerId" uuid NOT NULL, "opponentId" uuid NOT NULL, "status" "public"."duels_status_enum" NOT NULL DEFAULT 'PENDING', "winnerId" uuid, "loserId" uuid, "scoreDelta" integer, "allyBonusApplied" boolean NOT NULL DEFAULT false, "requestedAt" TIMESTAMP NOT NULL DEFAULT now(), "respondedAt" TIMESTAMP, "resultReportedAt" TIMESTAMP, "completedAt" TIMESTAMP, CONSTRAINT "PK_138743a525868817b14d09a0d3e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "duels" ADD CONSTRAINT "FK_9e2c3b499d461965da4ee0071c1" FOREIGN KEY ("challengerId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "duels" ADD CONSTRAINT "FK_5343b25c9121bd991f015ab0c96" FOREIGN KEY ("opponentId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duels" DROP CONSTRAINT "FK_5343b25c9121bd991f015ab0c96"`,
    );
    await queryRunner.query(
      `ALTER TABLE "duels" DROP CONSTRAINT "FK_9e2c3b499d461965da4ee0071c1"`,
    );
    await queryRunner.query(`DROP TABLE "duels"`);
    await queryRunner.query(`DROP TYPE "public"."duels_status_enum"`);
    await queryRunner.query(
      `ALTER TABLE "spot_claims" DROP CONSTRAINT "FK_7dc6d493ed47840cb1131b9e376"`,
    );
    await queryRunner.query(
      `ALTER TABLE "spot_claims" DROP CONSTRAINT "FK_099a429fad3780868bb1de16430"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_099a429fad3780868bb1de1643"`,
    );
    await queryRunner.query(`DROP TABLE "spot_claims"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "spots"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f9e7889a7513289576a19df5d8"`,
    );
    await queryRunner.query(`DROP TABLE "district_claims"`);
    // 확장(uuid-ossp, postgis)은 다른 객체가 공유할 수 있어 down에서 제거하지 않는다
  }
}
