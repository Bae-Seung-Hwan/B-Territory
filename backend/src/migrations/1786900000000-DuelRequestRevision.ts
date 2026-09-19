import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 결투 이벤트의 도착 순서에 의존하지 않도록 요청 식별자와 상태 버전을 둔다.
 *
 * - `requestId`: 클라이언트가 duel:request마다 만드는 uuid. 같은 신청자·같은 requestId의
 *   재시도는 새 결투를 만들지 않고 기존 결투를 돌려준다(멱등성). 구버전 앱은 보내지 않으므로
 *   NULL을 허용하고, 유니크 인덱스도 값이 있는 행에만 건다.
 * - `revision`: 상태 전이마다 1씩 오른다. 클라이언트는 결투별로 마지막으로 반영한 revision을
 *   들고, 그 이하의 이벤트·ack를 버린다 — ACCEPTED 뒤에 늦게 도착한 PENDING ack가 대기
 *   화면을 다시 여는 류의 역전을 순서가 아니라 버전으로 가린다.
 */
export class DuelRequestRevision1786900000000 implements MigrationInterface {
  name = 'DuelRequestRevision1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duels" ADD COLUMN IF NOT EXISTS "requestId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "duels" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_duels_challenger_request" ON "duels" ("challengerId", "requestId") WHERE "requestId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_duels_challenger_request"`,
    );
    await queryRunner.query(
      `ALTER TABLE "duels" DROP COLUMN IF EXISTS "revision"`,
    );
    await queryRunner.query(
      `ALTER TABLE "duels" DROP COLUMN IF EXISTS "requestId"`,
    );
  }
}
