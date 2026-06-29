import { create } from 'zustand';

interface GameStore {
  // districtId → nationality (e.g. 'KR', 'JP')
  occupiedDistricts: Record<string, string>;
  teamScores: Record<string, number>;
  capitalDistrict: string | null;
  topTeam: string | null;
  setOccupiedDistricts: (d: Record<string, string>) => void;
  setTeamScores: (s: Record<string, number>) => void;
  setCapitalDistrict: (d: string | null) => void;
}

export const useGameStore = create<GameStore>((set) => ({
  occupiedDistricts: {},
  teamScores: {},
  capitalDistrict: null,
  topTeam: null,
  setOccupiedDistricts: (occupiedDistricts) => set({ occupiedDistricts }),
  setTeamScores: (teamScores) => {
    const top = Object.entries(teamScores).sort(([, a], [, b]) => b - a)[0];
    set({ teamScores, topTeam: top?.[0] ?? null });
  },
  setCapitalDistrict: (capitalDistrict) => set({ capitalDistrict }),
}));
