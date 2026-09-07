import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 결투 초대가 실제로 상대에게 전달됐는지를 duels 행에 남긴다.
 *
 * 무응답 페널티는 "초대를 받고도 응답하지 않았다"에만 정당하다. 직전 구현은 만료 시점
 * (T+30s)에 상대 소켓이 살아 있는지를 보고 판단했는데, 끊김은 ping timeout이 지나야
 * 드러나므로 T+10s 이후의 단절은 만료 판정에 반영되지 않았다. 게다가 인메모리 타이머가
 * 유실된 경우(서버 재시작)에 도는 sweepStaleDuels는 그 판정 없이 무조건 청구했다.
 *
 * 전달 여부는 emit 시점에 이미 확정된 사실이므로, 그때 기록해 두면 두 경로 모두 같은
 * 근거로 판단할 수 있고 감지 지연에 의존하지 않는다. NULL = 전달되지 않음(큐에만 쌓임)
 * = 청구 대상 아님.
 */
export class DuelInviteDelivered1786600000000 implements MigrationInterface {
  name = 'DuelInviteDelivered1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duels" ADD COLUMN IF NOT EXISTS "inviteDeliveredAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duels" DROP COLUMN IF EXISTS "inviteDeliveredAt"`,
    );
  }
}
