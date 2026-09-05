export const ENCOUNTER_RADIUS_M = 100;
export const ENCOUNTER_COOLDOWN_TTL = 60; // 같은 쌍에 대한 조우 알림 재발송 방지 (초)
export const DUEL_REQUEST_TTL = 30; // 결투 신청 응답 대기 시간 (초)
export const DUEL_ACTIVE_TTL = 300; // 수락~결과 신고까지 페어 락을 유지하는 시간 (초)
export const DUEL_RESULT_TTL = 120; // 미니게임 결과 처리 중인 결투를 스윕에서 유예하는 시간 (초)
export const PENALTY_TTL = 1800; // 결투 패배 페널티 (30분, 초 단위)
export const BASE_DUEL_SCORE = 10;
// 결투를 성립시키지 않은 쪽에서 깎는 개인 점수. 승패 점수(BASE_DUEL_SCORE)의 1/5로 둔다 —
// 거절이 곧 패배가 되면 아무도 거절하지 못하고, 0이면 무한정 거절해도 손해가 없다.
export const DUEL_REJECT_SCORE_PENALTY = 2;
// 응답 없이 만료된 신청(DUEL_REQUEST_TTL 초과)에서 응답하지 않은 쪽을 깎는 점수.
// 거절과 반드시 같은 금액이어야 한다 — 무시가 더 싸면 거절 버튼은 아무도 누르지 않고,
// 페널티를 붙인 이유였던 회피 경로가 그대로 남는다.
export const DUEL_NO_RESPONSE_SCORE_PENALTY = DUEL_REJECT_SCORE_PENALTY;
// 점수를 문 쪽에게 붙는 보호 기간 (30분, 초 단위). 이 동안 아무도 그 유저에게 결투를 못 건다.
//
// 거절과 무응답 **양쪽 모두** 받는다. 무응답에 보호막을 주지 않으면, 만료 직후 페어 락이
// 풀리고 활성 결투도 없어져 같은 신청자가 30초마다 다시 걸 수 있다 — 신청자는 비용 0으로
// 상대 점수만 시간당 240점씩 빨아낸다(자리를 비운 유저는 방어도 못 한다). 보호막이 그
// 출혈을 30분에 2점으로 묶는다.
//
// PENALTY_TTL(결투 패배)과 값이 같지만 성격은 반대다 — 패배 페널티는 "내가 결투도 점령도
// 못 한다"이고, 이 보호막은 "남이 나에게 못 건다"라 점령과 내 신청은 그대로 열려 있다.
// 둘은 따로 조정할 값이므로 상수를 공유하지 않는다.
export const DUEL_SHIELD_TTL = 1800;
export const ALLY_BONUS_MULTIPLIER = 1.5;
export const ALLY_BONUS_MIN_COUNT = 2; // 승자 포함하지 않은 순수 아군 인원 수 기준
export const GEO_STALE_TTL = 600; // geo:users에서 유령 좌표로 간주해 정리하는 기준 (초, 10분)
export const GEO_PRUNE_INTERVAL_MS = 5 * 60 * 1000; // 유령 좌표 정리 주기 (5분)
export const DUEL_SWEEP_GRACE = 60; // 인메모리 만료 타이머·진행 중인 결과 처리와 경합하지 않도록 두는 여유 (초)
export const DUEL_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 방치된 결투(PENDING/ACCEPTED) 정리 주기 (5분)
export const NOTIFICATION_QUEUE_TTL = PENALTY_TTL; // 오프라인 상대에게 큐잉해두는 알림 보관 시간 (초)
