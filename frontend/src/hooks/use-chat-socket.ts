import { useCallback, useEffect, useRef, useState } from 'react';
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
 * 소켓 실패 종류 — 텍스트가 아니라 종류만 들고 있는다. 이 상태는 useEffect의 소켓
 * 이벤트 콜백 안에서 set되는데, 그 콜백은 마운트 시 한 번만 등록되므로 여기서 i18n
 * t()를 호출하면(매 렌더 새로 만들어지는 함수라) effect가 렌더마다 재실행되어 소켓이
 * 계속 재연결된다. 번역은 이 값을 소비하는 화면(ChatScreen)이 렌더 시점에 한다.
 */
export type ChatSocketError = 'connection' | 'rateLimit' | 'unknown';

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
  const { profile, isAuthenticated } = useAuth();
  const [chatError, setChatError] = useState<ChatSocketError | null>(null);

  // isAuthenticated에 의존해야 한다 — 마운트 시점에 Firebase 세션 복원이 아직 끝나지
  // 않았으면 auth.currentUser가 null이라 토큰을 못 읽는데, 이 값을 안 보면 세션이
  // 도착해도 effect가 다시 돌지 않아 영영 연결되지 않는다.
  useEffect(() => {
    if (!CHAT_ENABLED || !isAuthenticated) return;

    const socket: Socket = io(`${API_BASE_URL}/chat`, {
      autoConnect: false,
      transports: ['websocket'],
      // SocketProvider와 같은 이유로 함수형 auth를 쓴다 — 재연결마다 최신 토큰이 실린다.
      auth: (cb: (data: { token: string | null }) => void) => {
        void (async () => {
          try {
            cb({ token: (await auth.currentUser?.getIdToken()) ?? null });
          } catch {
            cb({ token: null });
          }
        })();
      },
    });
    socketRef.current = socket;

    // 인증 미들웨어(백엔드 ws-auth.ts)가 핸드셰이크에서 거부하면 클라이언트는 'connect'가
    // 아니라 'connect_error'를 받는다 — 이걸 구독하지 않으면 채팅이 이유 없이 계속
    // 재연결만 시도하는 것처럼 보인다(socket.io-client 기본 reconnection이 무한 재시도).
    socket.on('connect', () => setChatError(null));
    socket.on('connect_error', () => setChatError('connection'));

    // @SubscribeMessage 핸들러가 throw로 끝나면(레이트리밋 등) emit의 ack 콜백은 호출되지
    // 않고 서버가 별도로 'exception'을 emit한다(WsExceptionsFilter) — 이걸 구독하지 않으면
    // 레이트리밋에 걸려 릴레이가 안 된 메시지가, 이미 낙관적으로 추가된 로컬 화면에서는
    // 보낸 것처럼 그대로 남아 조용히 유실된다.
    socket.on('exception', (payload: { code?: string }) => {
      setChatError(payload?.code === 'CHAT_RATE_LIMIT' ? 'rateLimit' : 'unknown');
    });

    socket.on('chat:message', (payload: ChatMessageIncoming) => {
      addMessage({ kind: 'message', id: makeId(), mine: false, ...payload });
    });
    socket.on('team:location', (payload: TeamLocationIncoming) => {
      addMessage({ kind: 'location', id: makeId(), mine: false, ...payload });
    });

    socket.connect();

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [addMessage, isAuthenticated]);

  // 'rateLimit'/'unknown'은 그 순간의 전송 1건이 실패했다는 일시적 신호일 뿐이라(레이트리밋은
  // 몇 초 후 자연히 풀린다), 배너로 영구히 남기지 않고 잠깐 보여준 뒤 스스로 지운다.
  // 'connection'은 재연결로 실제 해소될 때까지(위 'connect' 핸들러) 남겨둔다.
  useEffect(() => {
    if (chatError !== 'rateLimit' && chatError !== 'unknown') return;
    const timer = setTimeout(() => setChatError(null), 4000);
    return () => clearTimeout(timer);
  }, [chatError]);

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

  return { sendMessage, shareLocation, chatError };
}
