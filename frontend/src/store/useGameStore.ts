import { create } from 'zustand';

interface GameStore {
  // districtId → nationality (e.g. 'KR', 'JP')
  occupiedDistricts: Record<string, string>;
  teamScores: Record<string, number>;
  capitalDistrict: string | null;
  setOccupiedDistricts: (d: Record<string, string>) => void;
  setTeamScores: (s: Record<string, number>) => void;
  setCapitalDistrict: (d: string | null) => void;
}

export const useGameStore = create<GameStore>((set) => ({
  occupiedDistricts: {},
  teamScores: {},
  capitalDistrict: null,
  setOccupiedDistricts: (occupiedDistricts) => set({ occupiedDistricts }),
  setTeamScores: (teamScores) => set({ teamScores }),
  setCapitalDistrict: (capitalDistrict) => set({ capitalDistrict }),
}));

/** teamScores에서 최고 점수 팀을 파생 계산 — 별도 상태로 저장하지 않아 항상 최신값과 동기화된다 */
export function getTopTeam(teamScores: Record<string, number>): string | null {
  const top = Object.entries(teamScores).sort(([, a], [, b]) => b - a)[0];
  return top?.[0] ?? null;
}
