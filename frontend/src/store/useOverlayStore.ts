import { create } from 'zustand';

// 이 체인(배틀 탭 리스트 행 → DuelRequest/DuelPending → MiniGame)은 SocketProvider의
// 소켓 리스너(encounter:detected, duel:requested/accepted/rejected/expired/completed/voided,
// game:start/go/opponent:submitted/round:result)가 트리거한다 — providers/SocketProvider.tsx 참고.

export type DuelRole = 'challenger' | 'recipient';

export type MiniGameType = 'TAP' | 'REACTION' | 'QUIZ';

/** 소켓에 lang 파라미터가 없어 서버가 ko/en을 함께 내려준다 — 표시 언어는 클라 i18n이 고른다. */
export interface LocalizedText {
  ko: string;
  en: string;
}

interface EnemyInfo {
  userId: string;
  nationality: string;
  distance: number;
  // 신청이 거부/만료됐을 때 배틀 탭 목록에 되살리기 위해 들고 있는다(PR #54 리뷰 지적
  // 11번) — duel:rejected/duel:expired 페이로드엔 duelId뿐이라 이 값이 유일한 출처다.
  // 수신자 쪽(duel:requested 처리)은 페이로드에 닉네임이 없어 null일 수 있다.
  nickname: string | null;
}

interface OverlayStore {
  // 수신자(상대의 결투 신청을 받은 쪽)용 수락/거부 시트
  showDuelRequest: boolean;
  // 신청자(내가 결투를 건 쪽)용 응답 대기 화면
  showDuelPending: boolean;
  showMiniGame: boolean;
  enemyInfo: EnemyInfo | null;
  // 결투 식별자. 백엔드가 발급하는 값을 그대로 받아 저장해둔다.
  duelId: number | null;
  // 신청자/수신자에 따라 결투 종료 후 알림 문구가 달라져야 해서 구분해둔다.
  duelRole: DuelRole | null;
  // duel:requested엔 team 정보가 없어(realtime.gateway.ts), 수신자용 DuelRequest 시트는
  // enemyInfo.nationality 대신 이 닉네임으로 문구를 구성한다.
  challengerNickname: string | null;
  // 아래부터는 미니게임 라운드 상태 — 전부 game:start/go/opponent:submitted/round:result가 채운다
  // (SocketProvider). 게임 종류·문제는 서버가 정하므로 로컬에서 결정론적으로 고르지 않는다.
  gameType: MiniGameType | null;
  gameRound: number | null;
  gameMaxRounds: number | null;
  /** 제출 마감 시각(epoch ms). 서버 시계 기준. */
  gameDeadlineAt: number | null;
  gameTap: { durationSec: number } | null;
  gameQuiz: { question: LocalizedText; choices: LocalizedText[] } | null;
  /** game:go 수신마다 증가하는 카운터 — ReactionGame이 이 값 변화를 구독해 phase를 전환한다. */
  goSignal: number;
  opponentSubmitted: boolean;
  setShowDuelRequest: (v: boolean) => void;
  setShowDuelPending: (v: boolean) => void;
  setShowMiniGame: (v: boolean) => void;
  setEnemyInfo: (info: EnemyInfo | null) => void;
  setDuelId: (id: number | null) => void;
  setDuelRole: (role: DuelRole | null) => void;
  setChallengerNickname: (name: string | null) => void;
  /** game:start 수신 시 라운드를 새로 연다 — 이전 라운드의 opponentSubmitted도 함께 리셋한다. */
  startGameRound: (round: {
    gameType: MiniGameType;
    round: number;
    maxRounds: number;
    deadlineAt: number;
    tap?: { durationSec: number };
    quiz?: { question: LocalizedText; choices: LocalizedText[] };
  }) => void;
  /** game:round:result(재경기) 수신 시 — 다음 game:start가 올 때까지 로딩 상태로 되돌린다. */
  clearGameRound: () => void;
  bumpGoSignal: () => void;
  setOpponentSubmitted: (v: boolean) => void;
  /** 결투 한 사이클(수락/거부/만료/완료/무효) 종료 시 관련 상태를 한 번에 초기화한다. */
  resetDuel: () => void;
}

/**
 * 결투 흐름이 진행 중이라 새 결투 신청(duel:requested)을 받으면 안 되는 상태인지.
 *
 * `duelId != null`을 포함하는 게 핵심이다 — 수락을 emit하고 서버의 duel:accepted를
 * 기다리는 왕복 구간처럼 "화면에 아무 오버레이도 없지만 결투는 살아있는" 순간이 있는데,
 * show* 플래그만 보면 이때 들어온 duel:requested가 duelId를 덮어써 원래 결투가
 * id 불일치로 영영 버려진다.
 */
export function isDuelBusy(s: OverlayStore): boolean {
  return (
    s.showDuelRequest ||
    s.showDuelPending ||
    s.showMiniGame ||
    s.duelId != null
  );
}

const GAME_ROUND_DEFAULTS = {
  gameType: null,
  gameRound: null,
  gameMaxRounds: null,
  gameDeadlineAt: null,
  gameTap: null,
  gameQuiz: null,
  opponentSubmitted: false,
} as const;

export const useOverlayStore = create<OverlayStore>((set) => ({
  showDuelRequest: false,
  showDuelPending: false,
  showMiniGame: false,
  enemyInfo: null,
  duelId: null,
  duelRole: null,
  challengerNickname: null,
  goSignal: 0,
  ...GAME_ROUND_DEFAULTS,
  setShowDuelRequest: (v) => set({ showDuelRequest: v }),
  setShowDuelPending: (v) => set({ showDuelPending: v }),
  setShowMiniGame: (v) => set({ showMiniGame: v }),
  setEnemyInfo: (info) => set({ enemyInfo: info }),
  setDuelId: (id) => set({ duelId: id }),
  setDuelRole: (role) => set({ duelRole: role }),
  setChallengerNickname: (name) => set({ challengerNickname: name }),
  startGameRound: (round) =>
    set({
      gameType: round.gameType,
      gameRound: round.round,
      gameMaxRounds: round.maxRounds,
      gameDeadlineAt: round.deadlineAt,
      gameTap: round.tap ?? null,
      gameQuiz: round.quiz ?? null,
      opponentSubmitted: false,
    }),
  clearGameRound: () => set(GAME_ROUND_DEFAULTS),
  bumpGoSignal: () => set((s) => ({ goSignal: s.goSignal + 1 })),
  setOpponentSubmitted: (v) => set({ opponentSubmitted: v }),
  resetDuel: () =>
    set({
      showDuelRequest: false,
      showDuelPending: false,
      showMiniGame: false,
      enemyInfo: null,
      duelId: null,
      duelRole: null,
      challengerNickname: null,
      ...GAME_ROUND_DEFAULTS,
    }),
}));
