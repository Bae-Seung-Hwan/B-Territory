import { useCallback, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '@/lib/api-client';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { CHAT_ENABLED } from '@/config/feature-flags';
import { useChatStore } from '@/store/useChatStore';
import type {
  ChatMessageIncoming,
  ChatMessageOutgoing,
  TeamLocationIncoming,
  TeamLocationOutgoing,
} from '@/types/chat-events';

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * `/chat` 네임스페이스(PR #34, 아직 develop 미merge) 전용 소켓. 채팅 탭이 마운트된
 * 동안에만 connect하고, 언마운트되면 disconnect한다(전역 SocketProvider와 분리된
 * 독립 생명주기 — realtime 소켓 작업과 서로 간섭하지 않는다).
 *
 * CHAT_ENABLED가 false인 동안은 소켓 인스턴스 자체를 만들지 않는다 — 백엔드에
 * `/chat` 게이트웨이가 없는 상태에서 연결을 시도해 콘솔에 재연결 에러를 반복 출력하지
 * 않기 위함. 이 상태에서도 전송 함수는 로컬 스토어에 낙관적으로만 반영되어 UI는
 * 그대로 동작한다.
 */
export function useChatSocket() {
  const socketRef = useRef<Socket | null>(null);
  const addMessage = useChatStore((s) => s.addMessage);
  const { profile } = useAuth();

  useEffect(() => {
    if (!CHAT_ENABLED) return;

    let cancelled = false;
    const socket: Socket = io(`${API_BASE_URL}/chat`, {
      autoConnect: false,
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('chat:message', (payload: ChatMessageIncoming) => {
      addMessage({ kind: 'message', id: makeId(), mine: false, ...payload });
    });
    socket.on('team:location', (payload: TeamLocationIncoming) => {
      addMessage({ kind: 'location', id: makeId(), mine: false, ...payload });
    });

    void (async () => {
      const token = await auth.currentUser?.getIdToken();
      if (cancelled || !token) return;
      socket.auth = { token };
      socket.connect();
    })();

    return () => {
      cancelled = true;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [addMessage]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !profile) return;
      const payload: ChatMessageOutgoing = { text: trimmed };
      socketRef.current?.emit('chat:message', payload);
      // 서버가 발신자를 제외하고 릴레이하므로(PR #34), 내 메시지는 낙관적으로 직접 추가한다.
      addMessage({
        kind: 'message',
        id: makeId(),
        mine: true,
        userId: profile.id,
        nickname: profile.nickname,
        team: profile.team,
        text: trimmed,
        at: new Date().toISOString(),
      });
    },
    [addMessage, profile],
  );

  const shareLocation = useCallback(
    (lat: number, lng: number) => {
      if (!profile) return;
      const payload: TeamLocationOutgoing = { lat, lng };
      socketRef.current?.emit('team:location', payload);
      addMessage({
        kind: 'location',
        id: makeId(),
        mine: true,
        userId: profile.id,
        nickname: profile.nickname,
        lat,
        lng,
        at: new Date().toISOString(),
      });
    },
    [addMessage, profile],
  );

  return { sendMessage, shareLocation };
}
