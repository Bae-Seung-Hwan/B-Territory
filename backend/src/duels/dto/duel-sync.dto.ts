import { IsInt, IsOptional, IsPositive, IsUUID } from 'class-validator';

/**
 * duel:sync 조회 조건. 둘 다 비우면 호출자가 참가 중인 진행 중(PENDING/ACCEPTED) 결투를 찾는다.
 *
 * - duelId: 알고 있는 결투의 현재 상태 (종료된 결투도 돌려준다)
 * - requestId: ack를 못 받아 duelId를 모를 때 — 본인이 신청한 결투만 찾는다
 */
export class DuelSyncDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  duelId?: number;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}
