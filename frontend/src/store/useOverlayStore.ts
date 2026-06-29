import { create } from 'zustand';

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
