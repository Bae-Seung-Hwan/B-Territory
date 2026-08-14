import { create } from 'zustand';

// 이 체인(EnemyDetectionAlert → DuelRequest/DuelPending → MiniGame)은 SocketProvider의
// 소켓 리스너(encounter:detected, duel:requested/accepted/rejected/expired/completed/voided)가
// 트리거한다 — providers/SocketProvider.tsx 참고.

export type DuelRole = 'challenger' | 'recipient';

export type MiniGameResult = 'win' | 'lose';

interface EnemyInfo {
  userId: string;
  nationality: string;
  distance: number;
}

interface OverlayStore {
  showEnemyAlert: boolean;
  // 수신자(상대의 결투 신청을 받은 쪽)용 수락/거부 시트
  showDuelRequest: boolean;
  // 신청자(내가 결투를 건 쪽)용 응답 대기 화면
  showDuelPending: boolean;
  showMiniGame: boolean;
  enemyInfo: EnemyInfo | null;
  // 결투 식별자. 백엔드가 발급하는 값을 그대로 받아 저장해두고,
  // MiniGame이 이 값을 시드로 미니게임 종류를 결정한다 (minigames/index.ts#pickGame).
  duelId: number | null;
  // 신청자/수신자에 따라 결투 종료 후 알림 문구가 달라져야 해서 구분해둔다.
  duelRole: DuelRole | null;
  // duel:requested엔 team 정보가 없어(realtime.gateway.ts), 수신자용 DuelRequest 시트는
  // enemyInfo.nationality 대신 이 닉네임으로 문구를 구성한다.
  challengerNickname: string | null;
  // 미니게임의 로컬 판정 결과. MiniGame의 컴포넌트 지역 state로 두면 서버 확정
  // (duel:completed 등)으로 오버레이가 닫힐 때 초기화될 기회가 없어 다음 결투에
  // 이전 결과 화면이 그대로 뜬다 — resetDuel이 함께 비우도록 스토어에 둔다.
  miniGameResult: MiniGameResult | null;
  setShowEnemyAlert: (v: boolean) => void;
  setShowDuelRequest: (v: boolean) => void;
  setShowDuelPending: (v: boolean) => void;
  setShowMiniGame: (v: boolean) => void;
  setEnemyInfo: (info: EnemyInfo | null) => void;
  setDuelId: (id: number | null) => void;
  setDuelRole: (role: DuelRole | null) => void;
  setChallengerNickname: (name: string | null) => void;
  setMiniGameResult: (result: MiniGameResult | null) => void;
  /** 결투 한 사이클(수락/거부/만료/완료/무효) 종료 시 관련 상태를 한 번에 초기화한다. */
  resetDuel: () => void;
}

/**
 * 결투 흐름이 진행 중이라 새 조우 알림·결투 신청을 받으면 안 되는 상태인지.
 *
 * `duelId != null`을 포함하는 게 핵심이다 — 수락을 emit하고 서버의 duel:accepted를
 * 기다리는 왕복 구간처럼 "화면에 아무 오버레이도 없지만 결투는 살아있는" 순간이 있는데,
 * show* 플래그만 보면 이때 들어온 duel:requested가 duelId를 덮어써 원래 결투가
 * id 불일치로 영영 버려진다.
 */
export function isDuelBusy(s: OverlayStore): boolean {
  return (
    s.showEnemyAlert ||
    s.showDuelRequest ||
    s.showDuelPending ||
    s.showMiniGame ||
    s.duelId != null
  );
}

export const useOverlayStore = create<OverlayStore>((set) => ({
  showEnemyAlert: false,
  showDuelRequest: false,
  showDuelPending: false,
  showMiniGame: false,
  enemyInfo: null,
  duelId: null,
  duelRole: null,
  challengerNickname: null,
  miniGameResult: null,
  setShowEnemyAlert: (v) => set({ showEnemyAlert: v }),
  setShowDuelRequest: (v) => set({ showDuelRequest: v }),
  setShowDuelPending: (v) => set({ showDuelPending: v }),
  setShowMiniGame: (v) => set({ showMiniGame: v }),
  setEnemyInfo: (info) => set({ enemyInfo: info }),
  setDuelId: (id) => set({ duelId: id }),
  setDuelRole: (role) => set({ duelRole: role }),
  setChallengerNickname: (name) => set({ challengerNickname: name }),
  setMiniGameResult: (miniGameResult) => set({ miniGameResult }),
  resetDuel: () =>
    set({
      showEnemyAlert: false,
      showDuelRequest: false,
      showDuelPending: false,
      showMiniGame: false,
      enemyInfo: null,
      duelId: null,
      duelRole: null,
      challengerNickname: null,
      miniGameResult: null,
    }),
}));
