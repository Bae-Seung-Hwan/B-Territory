import { create } from 'zustand';

interface UserStore {
  isAuthenticated: boolean;
  nationality: string | null;
  userId: string | null;
  setAuthenticated: (v: boolean) => void;
  setNationality: (n: string) => void;
  setUserId: (id: string) => void;
  logout: () => void;
}

export const useUserStore = create<UserStore>((set) => ({
  isAuthenticated: false,
  nationality: null,
  userId: null,
  setAuthenticated: (v) => set({ isAuthenticated: v }),
  setNationality: (n) => set({ nationality: n }),
  setUserId: (id) => set({ userId: id }),
  logout: () => set({ isAuthenticated: false, nationality: null, userId: null }),
}));
