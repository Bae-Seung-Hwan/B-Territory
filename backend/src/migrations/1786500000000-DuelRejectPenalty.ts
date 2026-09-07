import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 결투 거절·무응답 페널티 — 신청을 성립시키지 않은 쪽의 개인 점수를 소액 차감하고 원장에 남긴다.
 *
 * 스키마 변경은 score_events의 enum 값 추가 둘뿐이다. 보호 기간(duel:shield:*)은
 * Redis TTL 키라 스키마가 없고, duels.scoreDelta는 이미 있는 컬럼을 재사용한다
 * (REJECTED/EXPIRED 행에서는 "응답하지 않은 쪽에서 깎은 점수의 크기"를 뜻한다 — duel.entity.ts 참고).
 *
 * Postgres 12+는 ALTER TYPE ... ADD VALUE를 트랜잭션 안에서 허용하며, 같은 트랜잭션에서
 * 그 값을 **사용**하지만 않으면 된다. 여기서는 추가만 하므로 안전하다 (Missions 마이그레이션과 동일).
 */
export class DuelRejectPenalty1786500000000 implements MigrationInterface {
  name = 'DuelRejectPenalty1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."score_events_type_enum" ADD VALUE IF NOT EXISTS 'DUEL_REJECT'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."score_events_type_enum" ADD VALUE IF NOT EXISTS 'DUEL_NO_RESPONSE'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres는 enum 값 삭제를 지원하지 않는다. 되돌리려면 타입을 새로 만들어 컬럼을
    // 갈아끼워야 하는데, 이미 DUEL_REJECT/DUEL_NO_RESPONSE로 기록된 원장 행이 있으면 그 행을 먼저
    // 처리해야 한다(원장은 append-only라 삭제 대상이 아니다). 운영 판단이 필요한
    // 작업이라 자동 롤백은 제공하지 않는다 — up()은 IF NOT EXISTS라 재실행에 안전하다.
  }
}
