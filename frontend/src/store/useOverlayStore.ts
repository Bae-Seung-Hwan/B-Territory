import { create } from 'zustand';

// 이 체인(EnemyDetectionAlert → DuelRequest/DuelPending → MiniGame)은 SocketProvider의
// 소켓 리스너(encounter:detected, duel:requested/accepted/rejected/expired/completed/voided)가
// 트리거한다 — providers/SocketProvider.tsx 참고.

export type DuelRole = 'challenger' | 'recipient';

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
  setShowEnemyAlert: (v: boolean) => void;
  setShowDuelRequest: (v: boolean) => void;
  setShowDuelPending: (v: boolean) => void;
  setShowMiniGame: (v: boolean) => void;
  setEnemyInfo: (info: EnemyInfo | null) => void;
  setDuelId: (id: number | null) => void;
  setDuelRole: (role: DuelRole | null) => void;
  setChallengerNickname: (name: string | null) => void;
  /** 결투 한 사이클(수락/거부/만료/완료/무효) 종료 시 관련 상태를 한 번에 초기화한다. */
  resetDuel: () => void;
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
  setShowEnemyAlert: (v) => set({ showEnemyAlert: v }),
  setShowDuelRequest: (v) => set({ showDuelRequest: v }),
  setShowDuelPending: (v) => set({ showDuelPending: v }),
  setShowMiniGame: (v) => set({ showMiniGame: v }),
  setEnemyInfo: (info) => set({ enemyInfo: info }),
  setDuelId: (id) => set({ duelId: id }),
  setDuelRole: (role) => set({ duelRole: role }),
  setChallengerNickname: (name) => set({ challengerNickname: name }),
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
    }),
}));
