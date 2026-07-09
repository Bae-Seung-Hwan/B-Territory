import { create } from 'zustand';

interface UserStore {
  isAuthenticated: boolean;
  nationality: string | null;
  nickname: string | null;
  userId: string | null;
  setAuthenticated: (v: boolean) => void;
  setNationality: (n: string) => void;
  setNickname: (n: string) => void;
  setUserId: (id: string) => void;
  logout: () => void;
}

export const useUserStore = create<UserStore>((set) => ({
  isAuthenticated: false,
  nationality: null,
  nickname: null,
  userId: null,
  setAuthenticated: (v) => set({ isAuthenticated: v }),
  setNationality: (n) => set({ nationality: n }),
  setNickname: (n) => set({ nickname: n }),
  setUserId: (id) => set({ userId: id }),
  logout: () =>
    set({ isAuthenticated: false, nationality: null, nickname: null, userId: null }),
}));
