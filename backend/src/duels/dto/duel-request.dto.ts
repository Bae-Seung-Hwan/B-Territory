import { IsOptional, IsUUID } from 'class-validator';

export class DuelRequestDto {
  @IsUUID()
  targetUserId: string;

  /**
   * 클라이언트가 신청마다 새로 만드는 uuid. 같은 값으로 재시도하면 새 결투를 만들지 않고
   * 기존 결투의 현재 상태를 돌려준다. 구버전 앱이 400을 받지 않도록 선택 필드로 둔다.
   */
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
