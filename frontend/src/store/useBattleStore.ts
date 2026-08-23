import { create } from 'zustand';
import { BATTLE_ENEMY_STALE_MS } from '@/constants/game';

export interface NearbyEnemy {
  userId: string;
  nickname: string | null;
  team: string;
  lastSeenAt: number;
}

interface BattleStore {
  enemiesById: Record<string, NearbyEnemy>;
  upsertEnemy: (payload: { userId: string; nickname: string | null; team: string }) => void;
  removeEnemy: (userId: string) => void;
  /** BATTLE_ENEMY_STALE_MS 이상 갱신이 없던 항목을 제거한다 — SocketProvider의 주기 스윕이 호출한다. */
  pruneStale: (now: number) => void;
}

export const useBattleStore = create<BattleStore>((set, get) => ({
  enemiesById: {},
  upsertEnemy: (payload) =>
    set((state) => ({
      enemiesById: {
        ...state.enemiesById,
        [payload.userId]: { ...payload, lastSeenAt: Date.now() },
      },
    })),
  removeEnemy: (userId) =>
    set((state) => {
      if (!(userId in state.enemiesById)) return state;
      const next = { ...state.enemiesById };
      delete next[userId];
      return { enemiesById: next };
    }),
  pruneStale: (now) => {
    const { enemiesById } = get();
    const fresh = Object.values(enemiesById).filter(
      (e) => now - e.lastSeenAt <= BATTLE_ENEMY_STALE_MS,
    );
    // 만료된 항목이 없으면 set을 건너뛰어 불필요한 리렌더를 피한다.
    if (fresh.length === Object.keys(enemiesById).length) return;
    set({ enemiesById: Object.fromEntries(fresh.map((e) => [e.userId, e])) });
  },
}));

/** lastSeenAt 내림차순(최근 감지 순)으로 정렬된 배열 셀렉터. */
export function selectSortedEnemies(s: BattleStore): NearbyEnemy[] {
  return Object.values(s.enemiesById).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}
