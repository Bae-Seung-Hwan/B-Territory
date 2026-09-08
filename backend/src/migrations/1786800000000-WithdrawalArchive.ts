import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 탈퇴 후에도 남겨야 하는 것만 가명으로 보관하는 표들.
 *
 * 탈퇴하면 `users` 행이 하드 삭제되면서 `user_consents`가 CASCADE로 사라지고
 * `reports.targetUserId`가 NULL이 된다. 그 결과 "동의를 받고 가입시켰다"는 사실도, 접수된
 * 신고가 **누구에 대한 것이었는지**도 남지 않아, 분쟁이 탈퇴 이후에 불거지는 가장 흔한
 * 경우(제재 불복 이의제기)에 증거가 없었다(docs/compliance.md 6장).
 *
 * 남기는 것은 계정 식별자·약관 동의·신고 연결 셋뿐이고, 식별정보는 옮기지 않는다.
 * `withdrawn_accounts`에 남는 것은 탈퇴 건마다 새로 뽑은 소금과 함께 해싱한 값뿐이라,
 * 이메일을 제시받았을 때 대조만 되고 표를 역산해 명단을 뽑을 수는 없다.
 */
export class WithdrawalArchive1786800000000 implements MigrationInterface {
  name = 'WithdrawalArchive1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "withdrawn_accounts" ("id" SERIAL NOT NULL, "subjectHash" character varying(64) NOT NULL, "subjectSalt" character varying(32) NOT NULL, "withdrawnAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_withdrawn_accounts" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_withdrawn_accounts_subject" ON "withdrawn_accounts" ("subjectHash")`,
    );
    await queryRunner.query(
      `CREATE TABLE "consent_archives" ("id" SERIAL NOT NULL, "withdrawalId" integer NOT NULL, "document" character varying(20) NOT NULL, "version" character varying(20) NOT NULL, "agreedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_consent_archives" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_consent_archives_withdrawal" ON "consent_archives" ("withdrawalId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "consent_archives" ADD CONSTRAINT "FK_consent_archives_withdrawal" FOREIGN KEY ("withdrawalId") REFERENCES "withdrawn_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD "withdrawnTargetId" integer`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reports_withdrawn_target" ON "reports" ("withdrawnTargetId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_reports_withdrawn_target" FOREIGN KEY ("withdrawnTargetId") REFERENCES "withdrawn_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "FK_reports_withdrawn_target"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_reports_withdrawn_target"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" DROP COLUMN "withdrawnTargetId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "consent_archives" DROP CONSTRAINT "FK_consent_archives_withdrawal"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_consent_archives_withdrawal"`,
    );
    await queryRunner.query(`DROP TABLE "consent_archives"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_withdrawn_accounts_subject"`,
    );
    await queryRunner.query(`DROP TABLE "withdrawn_accounts"`);
  }
}
