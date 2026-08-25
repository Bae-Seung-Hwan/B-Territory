import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * duels의 참가자 FK를 NO ACTION → SET NULL로 바꾸고 컬럼을 nullable로 만든다.
 *
 * 계정 삭제(탈퇴)를 가능하게 하기 위한 변경이다. users를 참조하는 다른 테이블
 * (spot_claims·score_events·claim_score_events·point_events)은 모두 SET NULL인데
 * duels만 NO ACTION이라, 결투 이력이 있는 유저는 하드 삭제 시 FK 위반(23503)으로
 * 탈퇴가 실패했다.
 *
 * CASCADE가 아닌 SET NULL인 이유: 결투는 두 사람의 기록이라 한쪽이 탈퇴했다고 행을
 * 지우면 상대방의 전적까지 사라진다.
 */
export class DuelUserFkSetNull1786400000000 implements MigrationInterface {
  name = 'DuelUserFkSetNull1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duels" DROP CONSTRAINT "FK_9e2c3b499d461965da4ee0071c1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "duels" DROP CONSTRAINT "FK_5343b25c9121bd991f015ab0c96"`,
    );
    await queryRunner.query(
      `ALTER TABLE "duels" ALTER COLUMN "challengerId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "duels" ALTER COLUMN "opponentId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "duels" ADD CONSTRAINT "FK_9e2c3b499d461965da4ee0071c1" FOREIGN KEY ("challengerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "duels" ADD CONSTRAINT "FK_5343b25c9121bd991f015ab0c96" FOREIGN KEY ("opponentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // NOT NULL 복원은 탈퇴로 생긴 NULL 행이 있으면 실패한다. 되돌리려면 그 행들을
    // 먼저 정리해야 하며, 그 판단(삭제할지 더미 유저로 채울지)은 운영에서 해야 한다.
    await queryRunner.query(
      `ALTER TABLE "duels" DROP CONSTRAINT "FK_5343b25c9121bd991f015ab0c96"`,
    );
    await queryRunner.query(
      `ALTER TABLE "duels" DROP CONSTRAINT "FK_9e2c3b499d461965da4ee0071c1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "duels" ALTER COLUMN "opponentId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "duels" ALTER COLUMN "challengerId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "duels" ADD CONSTRAINT "FK_9e2c3b499d461965da4ee0071c1" FOREIGN KEY ("challengerId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "duels" ADD CONSTRAINT "FK_5343b25c9121bd991f015ab0c96" FOREIGN KEY ("opponentId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
