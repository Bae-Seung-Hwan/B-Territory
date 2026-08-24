import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 신고·차단 (UGC 운영) — Apple 심사 가이드라인 1.2가 요구하는 수단.
 *
 * user_blocks: 두 FK 모두 CASCADE. 차단 관계는 양쪽 계정이 존재할 때만 의미가 있는
 * 파생 데이터라, 한쪽이 탈퇴하면 관계도 사라지는 게 맞다.
 *
 * reports: 두 FK 모두 SET NULL. 한쪽이 탈퇴해도 접수 기록과 메시지 스냅샷은 남아야
 * "적시 대응"의 근거가 된다(원장과 같은 성격). targetNickname을 비정규화해 FK가
 * 끊긴 뒤에도 누구에 대한 신고였는지 알 수 있게 한다.
 */
export class Moderation1786410000000 implements MigrationInterface {
  name = 'Moderation1786410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_blocks" ("id" SERIAL NOT NULL, "blockerId" uuid NOT NULL, "blockedId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_user_blocks_pair" UNIQUE ("blockerId", "blockedId"), CONSTRAINT "PK_user_blocks" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_blocks_blockedId" ON "user_blocks" ("blockedId")`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."reports_reason_enum" AS ENUM('SPAM', 'ABUSE', 'SEXUAL', 'HATE', 'OTHER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."reports_status_enum" AS ENUM('PENDING', 'REVIEWED', 'ACTIONED', 'DISMISSED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "reports" ("id" SERIAL NOT NULL, "reporterId" uuid, "targetUserId" uuid, "targetNickname" character varying(50), "reason" "public"."reports_reason_enum" NOT NULL, "contentSnapshot" text, "detail" text, "status" "public"."reports_status_enum" NOT NULL DEFAULT 'PENDING', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_reports" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reports_target_createdAt" ON "reports" ("targetUserId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reports_status_createdAt" ON "reports" ("status", "createdAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_blocks" ADD CONSTRAINT "FK_user_blocks_blocker" FOREIGN KEY ("blockerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_blocks" ADD CONSTRAINT "FK_user_blocks_blocked" FOREIGN KEY ("blockedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_reports_reporter" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_reports_target" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "FK_reports_target"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "FK_reports_reporter"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_blocks" DROP CONSTRAINT "FK_user_blocks_blocked"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_blocks" DROP CONSTRAINT "FK_user_blocks_blocker"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_reports_status_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_reports_target_createdAt"`,
    );
    await queryRunner.query(`DROP TABLE "reports"`);
    await queryRunner.query(`DROP TYPE "public"."reports_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."reports_reason_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_user_blocks_blockedId"`);
    await queryRunner.query(`DROP TABLE "user_blocks"`);
  }
}
