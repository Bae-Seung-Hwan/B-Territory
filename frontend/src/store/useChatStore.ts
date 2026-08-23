import { create } from 'zustand';

export interface ChatFeedItem {
  id: string;
  userId: string;
  nickname: string;
  team: string;
  text: string;
  at: string;
  mine: boolean;
}

// PR #34(ChatGateway)는 메시지를 DB에 저장하지 않는 순수 릴레이 방식이라, 이 배열이
// 유일한 보관소다. 앱을 재시작하면 사라지는 게 의도된 동작(로컬 전용 저장).
const MAX_MESSAGES = 200;

interface ChatStore {
  messages: ChatFeedItem[];
  addMessage: (item: ChatFeedItem) => void;
  clear: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  addMessage: (item) =>
    set((state) => ({ messages: [...state.messages, item].slice(-MAX_MESSAGES) })),
  clear: () => set({ messages: [] }),
}));
