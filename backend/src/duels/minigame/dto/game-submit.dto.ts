import { IsInt, IsOptional, IsPositive, Min } from 'class-validator';

/**
 * 미니게임 라운드 결과 제출.
 *
 * 클라이언트는 "내가 이겼다"도, "몇 초 걸렸다"도 보내지 않는다 — 자기가 **무엇을 골랐는지**만
 * 알린다. 승패와 소요 시간은 서버가 자기 시계로 계산한다.
 *
 * - TAP: `value` = 탭 횟수 (서버가 재현할 수 없는 유일한 값)
 * - QUIZ: `value` = 고른 선택지 인덱스 (정답 여부·응답 속도는 서버가 판정)
 * - REACTION: `value` 불필요 — "지금 눌렀다"는 사실만 있으면 되고, 반응 시간은
 *   서버가 game:go를 쏜 시각과 이 요청이 도착한 시각의 차이로 직접 잰다
 */
export class GameSubmitDto {
  @IsInt()
  @IsPositive()
  duelId: number;

  /** 재경기 구분용. 서버 세션의 현재 라운드와 다르면 거부된다(늦게 도착한 이전 라운드 제출). */
  @IsInt()
  @IsPositive()
  round: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  value?: number;
}
