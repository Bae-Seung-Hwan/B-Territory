/** 결투 중 진행하는 미니게임의 종류. 서버가 세션 시작 시 골라 game:start로 내려준다. */
export enum MiniGameType {
  /** 제한시간 동안 탭 횟수를 겨룬다 (많을수록 승) */
  TAP = 'TAP',
  /** 신호가 켜진 뒤 반응 시간을 겨룬다 (빠를수록 승) */
  REACTION = 'REACTION',
  /** 4지선다 퀴즈 (정답 우선, 둘 다 정답이면 빠를수록 승) */
  QUIZ = 'QUIZ',
}

export const MINI_GAME_TYPES = Object.values(MiniGameType);

/**
 * 라운드 하나의 제출 마감 (초). 클라이언트가 game:start를 받고 게임을 끝내 제출하기까지의
 * 여유 — 게임 자체 진행시간(연타 5초, 반응속도 최대 3초 대기)보다 넉넉해야 한다.
 *
 * MAX_ROUNDS까지 다 써도 DUEL_ACTIVE_TTL(300초)에 한참 못 미쳐야 한다 — 그래야 게임이
 * 정상 진행 중인 결투를 sweepStaleDuels가 VOID로 선점하지 않는다.
 */
export const GAME_ROUND_TIMEOUT = 45;

/** 최초 1판 + 동점 시 재경기 1판. 재경기도 동점이면 결투를 VOID 처리한다. */
export const MAX_ROUNDS = 2;

/** 세션/점수 키 보관 시간 (초). 마지막 라운드가 끝나고도 늦게 도착한 제출을 거부할 수 있어야 한다. */
export const GAME_SESSION_TTL = GAME_ROUND_TIMEOUT * MAX_ROUNDS + 60;

// --- TAP ---
/** 프론트 TapBattle의 DURATION_SEC와 같은 값이어야 한다 */
export const TAP_DURATION_SEC = 5;
/**
 * 사람이 낼 수 있는 초당 탭 수의 상한. 탭 카운트만은 서버가 재현할 방법이 없어
 * (서버는 손가락을 볼 수 없다) 이 상한과 최소 경과시간 검사가 방어의 전부다.
 * 정상 플레이가 5초에 25~35탭이므로 여유를 조금만 두고 잡는다 — 상한이 높을수록
 * 조작된 값이 그대로 통과하는 폭이 넓어진다.
 */
export const TAP_MAX_PER_SEC = 12;
export const TAP_MAX = TAP_DURATION_SEC * TAP_MAX_PER_SEC;

// --- REACTION ---
/**
 * 서버가 game:go 신호를 쏘기까지의 랜덤 대기 범위(ms).
 *
 * 이 대기를 서버가 정하고 발사 시각도 서버가 기록하는 것이 이 게임의 핵심이다 —
 * 클라이언트가 스스로 신호를 만들면 반응 시간을 아무 값이나 주장할 수 있다.
 * 이 범위는 절대 클라이언트에 내려보내지 않는다(미리 알면 예측 탭이 가능하다).
 */
export const REACTION_GO_MIN_MS = 1_000;
export const REACTION_GO_MAX_MS = 3_000;
/**
 * 사람의 단순 반응 속도 하한(ms). 서버 측정값은 네트워크 왕복을 포함하므로 이보다
 * 낮게 나올 일이 사실상 없지만, 나오더라도 이득을 주지 않도록 이 값으로 끌어올린다.
 */
export const REACTION_MIN_MS = 80;
/** 이보다 느린 반응은 사실상 포기로 보고, 느린 쪽끼리는 우열을 가리지 않는다. */
export const REACTION_MAX_MS = 5_000;

// --- QUIZ ---
export const QUIZ_CHOICE_COUNT = 4;
/**
 * 문제를 읽는 데 최소한 걸리는 시간(ms). 이보다 빨리 도착한 정답은 읽고 답한 게 아니라
 * 찍은 것이므로 속도 이점을 주지 않는다 — 없으면 "즉시 찍기"가 타이브레이크를 항상 이긴다.
 */
export const QUIZ_MIN_READ_MS = 800;
/** 퀴즈 응답 시간의 상한(ms). 오답자의 타이브레이크 값으로도 쓰인다. */
export const QUIZ_MAX_MS = 30_000;

/**
 * 참가 정도에 따른 1차 점수 하한. 정상 제출의 1차 점수는 항상 0 이상이므로 아래 둘보다 높다.
 *
 * 부정출발과 미제출을 같은 값으로 두면 안 된다 — 그러면 "신호 전에 눌러버린 사람"과
 * "아예 앱을 꺼버린 사람"이 무승부가 되어, 잠수로 패배를 피하는 길이 열린다.
 * 부정출발은 어쨌든 참여했으므로 미제출보다는 위에 둔다.
 */
export const NO_SUBMIT_PRIMARY = -2;
export const FALSE_START_PRIMARY = -1;
