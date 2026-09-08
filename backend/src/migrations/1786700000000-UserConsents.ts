import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 가입 동의 이력 원장 테이블 생성.
 *
 * users FK를 ON DELETE CASCADE로 건다 — 탈퇴 시 함께 지워진다. 법정 보존 의무가 확인된
 * `location_usage_logs`(위치정보법 제16조 2항)와 달리 동의 이력에는 그런 근거가 아직 없어,
 * 개인정보처리방침이 약속한 "탈퇴 시 지체 없이 삭제"를 지키는 쪽을 기본값으로 둔다.
 * 보존이 필요하다는 결론이 나면 FK를 떼는 마이그레이션으로 전환한다(docs/compliance.md 6장).
 *
 * (userId, document)에 UNIQUE를 걸지 않는다 — 문서 개정 후 재동의가 새 행으로 쌓이는
 * append-only 원장이라, 유니크를 걸면 개정 전 동의 기록이 덮여 사라진다.
 */
export class UserConsents1786700000000 implements MigrationInterface {
  name = 'UserConsents1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_consents" ("id" SERIAL NOT NULL, "userId" uuid NOT NULL, "document" character varying(20) NOT NULL, "version" character varying(20) NOT NULL, "agreedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_user_consents" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_consents_user_document" ON "user_consents" ("userId", "document")`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_consents" ADD CONSTRAINT "FK_user_consents_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_consents" DROP CONSTRAINT "FK_user_consents_user"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_user_consents_user_document"`,
    );
    await queryRunner.query(`DROP TABLE "user_consents"`);
  }
}
