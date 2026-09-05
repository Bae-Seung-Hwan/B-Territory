import { create } from 'zustand';

/**
 * 'sending'/'failed'는 내가 보낸(mine:true) 메시지에만 쓴다 — 서버가 릴레이해서
 * 도착한 남의 메시지는 이미 전달된 것이므로 status가 없다(undefined).
 * 'sending' → ack 대기 중, 'failed' → ack가 타임아웃까지 안 옴(레이트리밋 등으로
 * 핸들러가 throw해 ack 콜백 자체가 호출되지 않은 경우). 성공하면 status를 지운다.
 */
export interface ChatFeedItem {
  id: string;
  userId: string;
  nickname: string;
  team: string;
  text: string;
  at: string;
  mine: boolean;
  status?: 'sending' | 'failed';
}

// PR #34(ChatGateway)는 메시지를 DB에 저장하지 않는 순수 릴레이 방식이라, 이 배열이
// 유일한 보관소다. 앱을 재시작하면 사라지는 게 의도된 동작(로컬 전용 저장).
const MAX_MESSAGES = 200;

interface ChatStore {
  messages: ChatFeedItem[];
  addMessage: (item: ChatFeedItem) => void;
  /**
   * id로 특정 메시지의 status만 갱신한다(ack 결과 반영). MAX_MESSAGES 상한에 밀려
   * 이미 배열에서 잘려나간 id면 조용히 아무 일도 하지 않는다 — ack는 그보다 훨씬
   * 짧은 시간 안에 오므로 실무에서는 거의 발생하지 않는다.
   */
  setMessageStatus: (id: string, status: ChatFeedItem['status']) => void;
  /**
   * 한 사용자가 보낸 메시지를 피드에서 걷어낸다(차단 시 호출).
   *
   * 화면 단의 차단 필터만으로도 안 보이게는 되지만, 그건 차단이 유지되는 동안만이라
   * 나중에 차단을 풀면 예전 메시지가 되살아난다 — 괴롭힘 때문에 차단한 경우 그
   * 메시지가 다시 나타나는 건 의도한 동작이 아니다. 스토어에서 아예 지운다.
   */
  removeMessagesByUser: (userId: string) => void;
  clear: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  addMessage: (item) =>
    set((state) => ({ messages: [...state.messages, item].slice(-MAX_MESSAGES) })),
  setMessageStatus: (id, status) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, status } : m)),
    })),
  removeMessagesByUser: (userId) =>
    set((state) => ({
      // 내 메시지는 남긴다 — 차단 대상과 userId가 같을 수 없지만(자기 차단은 서버가
      // BLOCK_SELF로 막는다), 낙관적 표시 중인 내 메시지가 휩쓸리지 않게 명시한다.
      messages: state.messages.filter((m) => m.mine || m.userId !== userId),
    })),
  clear: () => set({ messages: [] }),
}));
