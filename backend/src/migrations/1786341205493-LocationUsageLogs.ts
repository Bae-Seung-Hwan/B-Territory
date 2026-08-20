import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 위치정보 이용·제공사실 확인자료 원장(위치정보법 제16조 2항) 테이블 생성.
 * users에 FK를 걸지 않는다 — 이용자 탈퇴 후에도 기록 당시의 식별값이 그대로 남아야 하는 법정 자료다.
 */
export class LocationUsageLogs1786341205493 implements MigrationInterface {
  name = 'LocationUsageLogs1786341205493';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "location_usage_logs" ("id" SERIAL NOT NULL, "subjectId" uuid NOT NULL, "acquisitionPath" character varying(20) NOT NULL, "service" character varying(20) NOT NULL, "recipient" character varying(100), "usedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_50eac842440e268f6a2ef76c077" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d6a7df4b875d3f028e0727ed43" ON "location_usage_logs"  ("usedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d4079169adafd2962c3f451016" ON "location_usage_logs"  ("subjectId", "usedAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d4079169adafd2962c3f451016"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d6a7df4b875d3f028e0727ed43"`,
    );
    await queryRunner.query(`DROP TABLE "location_usage_logs"`);
  }
}
