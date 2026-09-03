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
  // 리스트 전체가 공유하는 단일 값이다(행마다 로컬 state로 두면, 한 행의 duel:request
  // 실패로 온 exception이 다른 행의 pending도 함께 지워야 하는지 판단할 수 없어 아무 행이나
  // 건드리게 된다 — exception 페이로드엔 어떤 요청에 대한 것인지 알려줄 duelId가 없다).
  // 이 값이 채워진 동안엔 리스트의 모든 Challenge 버튼을 막아 애초에 동시 신청이 안 생기게 한다.
  pendingChallengeTargetId: string | null;
  upsertEnemy: (payload: { userId: string; nickname: string | null; team: string }) => void;
  removeEnemy: (userId: string) => void;
  /** BATTLE_ENEMY_STALE_MS 이상 갱신이 없던 항목을 제거한다 — SocketProvider의 주기 스윕이 호출한다. */
  pruneStale: (now: number) => void;
  setPendingChallengeTargetId: (userId: string | null) => void;
}

export const useBattleStore = create<BattleStore>((set, get) => ({
  enemiesById: {},
  pendingChallengeTargetId: null,
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
  setPendingChallengeTargetId: (userId) => set({ pendingChallengeTargetId: userId }),
}));

/** lastSeenAt 내림차순(최근 감지 순)으로 정렬된 배열 셀렉터. */
export function selectSortedEnemies(s: BattleStore): NearbyEnemy[] {
  return Object.values(s.enemiesById).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}
