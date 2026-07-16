import { create } from 'zustand';

// TODO: setShowEnemyAlert(true)/setEnemyInfo(...)를 호출해 이 체인(EnemyDetectionAlert →
// DuelRequest → MiniGame)을 실제로 트리거하는 지점이 아직 없음(소켓 encounter:detected 미배선).
// docs/integrations.md 참고

interface EnemyInfo {
  nationality: string;
  distance: number;
}

interface OverlayStore {
  showEnemyAlert: boolean;
  showDuelRequest: boolean;
  showMiniGame: boolean;
  enemyInfo: EnemyInfo | null;
  setShowEnemyAlert: (v: boolean) => void;
  setShowDuelRequest: (v: boolean) => void;
  setShowMiniGame: (v: boolean) => void;
  setEnemyInfo: (info: EnemyInfo | null) => void;
}

export const useOverlayStore = create<OverlayStore>((set) => ({
  showEnemyAlert: false,
  showDuelRequest: false,
  showMiniGame: false,
  enemyInfo: null,
  setShowEnemyAlert: (v) => set({ showEnemyAlert: v }),
  setShowDuelRequest: (v) => set({ showDuelRequest: v }),
  setShowMiniGame: (v) => set({ showMiniGame: v }),
  setEnemyInfo: (info) => set({ enemyInfo: info }),
}));
