import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '@/lib/api-client';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { CHAT_ENABLED } from '@/config/feature-flags';
import { useChatStore, type ChatFeedItem } from '@/store/useChatStore';
import type { ChatMessageIncoming, ChatMessageOutgoing } from '@/types/chat-events';

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// 백엔드 ChatMessageDto의 @Length(1, 500)과 일치시킨다. ChatScreen의 TextInput이
// maxLength로 입력 자체를 막아 정상 경로에서는 닿을 일이 없지만, sendMessage는 훅의
// 공개 API라 호출부를 신뢰하지 않고 여기서도 한 번 더 막는다 — 없으면 초과분이
// 로컬에는 "보낸 메시지"로 낙관적 추가되고 서버에서만 조용히 거부된다.
const MAX_MESSAGE_LENGTH = 500;

// ack 대기 상한(ms). 핸들러가 throw로 끝나면(레이트리밋 등) NestJS는 ack 콜백 자체를
// 호출하지 않으므로, 서버 변경 없이 클라이언트가 스스로 타임아웃을 걸어 "ack가 이
// 시간 안에 안 왔다 = 거부됐다"로 판정한다. 백엔드 레이트리밋 윈도우(MSG_WINDOW_SEC,
// chat.gateway.ts)와 정확히 같은 5초로 맞춰, 정상적으로 윈도우가 갱신되는 순간까지는
// 기다리되 그 이상은 실패로 본다.
const ACK_TIMEOUT_MS = 5_000;

/**
 * 소켓 실패 종류 — 텍스트가 아니라 종류만 들고 있는다. 이 상태는 useEffect의 소켓
 * 이벤트 콜백 안에서 set되는데, 그 콜백은 마운트 시 한 번만 등록되므로 여기서 i18n
 * t()를 호출하면(매 렌더 새로 만들어지는 함수라) effect가 렌더마다 재실행되어 소켓이
 * 계속 재연결된다. 번역은 이 값을 소비하는 화면(ChatScreen)이 렌더 시점에 한다.
 */
export type ChatSocketError = 'connection' | 'rateLimit' | 'unknown';

/**
 * `/chat` 네임스페이스(PR #34, 아직 develop 미merge) 전용 소켓. 채팅 탭이 포커스를
 * 갖고 있는 동안에만 connect하고, 포커스를 잃으면(다른 탭으로 이동) disconnect한다
 * (전역 SocketProvider와 분리된 독립 생명주기 — realtime 소켓 작업과 서로 간섭하지
 * 않는다). expo-router의 Tabs는 방문한 화면을 언마운트하지 않으므로 "언마운트되면"이
 * 아니라 `useIsFocused()`로 판정해야 한다 — 그러지 않으면 채팅 탭을 한 번만 열어도
 * 앱 세션 내내 소켓이 연결된 채 남아 다른 탭에 있는 동안에도 모든 팀 메시지를 계속
 * 받아 스토어에 쌓는다(PR #50 2차 리뷰 지적 2번, PR #49의 랭킹 폴링과 같은 원인).
 *
 * CHAT_ENABLED가 false인 동안은 소켓 인스턴스 자체를 만들지 않는다 — 백엔드에
 * `/chat` 게이트웨이가 없는 상태에서 연결을 시도해 콘솔에 재연결 에러를 반복 출력하지
 * 않기 위함. 이 상태에서도 전송 함수는 로컬 스토어에 낙관적으로만 반영되어 UI는
 * 그대로 동작한다.
 */
export function useChatSocket() {
  const socketRef = useRef<Socket | null>(null);
  // exception이 어떤 emit을 거부한 것인지 서버가 알려주지 않는다({ code }만 온다) —
  // 레이트리밋은 그 순간 보낸 메시지가 임계값을 넘겨서 걸리므로, 가장 최근에 보낸
  // ack 대기 중 메시지가 거부 대상이라고 본다. 두 메시지가 동시에 대기 중인 드문
  // 경우엔 더 이전 메시지를 잘못 짚을 수 있지만, 그래도 ACK_TIMEOUT_MS 시점에는
  // 결국 failed로 정리된다.
  const pendingIdRef = useRef<string | null>(null);
  const addMessage = useChatStore((s) => s.addMessage);
  const setMessageStatus = useChatStore((s) => s.setMessageStatus);
  const { profile, isAuthenticated } = useAuth();
  const [chatError, setChatError] = useState<ChatSocketError | null>(null);
  const isFocused = useIsFocused();

  // isAuthenticated에 의존해야 한다 — 마운트 시점에 Firebase 세션 복원이 아직 끝나지
  // 않았으면 auth.currentUser가 null이라 토큰을 못 읽는데, 이 값을 안 보면 세션이
  // 도착해도 effect가 다시 돌지 않아 영영 연결되지 않는다.
  useEffect(() => {
    if (!CHAT_ENABLED || !isAuthenticated || !isFocused) return;

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
      // exception은 ack 콜백과 달리 즉시 도착한다 — ACK_TIMEOUT_MS(5초)까지 기다리지
      // 않고 바로 failed로 넘겨야, 배너(4초 뒤 자동 소거)가 사라지고도 1초 뒤에야
      // 말풍선이 이유 없이 실패로 바뀌는 일이 없다(PR #50 2차 리뷰 지적 1번).
      const pendingId = pendingIdRef.current;
      if (pendingId) {
        pendingIdRef.current = null;
        setMessageStatus(pendingId, 'failed');
      }
    });

    socket.on('chat:message', (payload: ChatMessageIncoming) => {
      addMessage({ id: makeId(), mine: false, ...payload });
    });

    socket.connect();

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [addMessage, isAuthenticated, isFocused, setMessageStatus]);

  // 'rateLimit'/'unknown'은 그 순간의 전송 1건이 실패했다는 일시적 신호일 뿐이라(레이트리밋은
  // 몇 초 후 자연히 풀린다), 배너로 영구히 남기지 않고 잠깐 보여준 뒤 스스로 지운다.
  // 'connection'은 재연결로 실제 해소될 때까지(위 'connect' 핸들러) 남겨둔다.
  useEffect(() => {
    if (chatError !== 'rateLimit' && chatError !== 'unknown') return;
    const timer = setTimeout(() => setChatError(null), 4000);
    return () => clearTimeout(timer);
  }, [chatError]);

  /**
   * ack로 이 메시지 하나의 성패를 판정한다. 성공하면 서버가 이미 돌려주는
   * { status: 'ok' }가 ack로 그대로 온다(백엔드 변경 불필요). 실패(레이트리밋 등
   * 핸들러 throw)는 ack 콜백 자체가 호출되지 않는다는 게 기존 문서화된 동작이라,
   * 서버가 여전히 몰라도 socket.io-client의 timeout()이 ACK_TIMEOUT_MS 안에 ack가
   * 안 오면 스스로 에러를 만들어 콜백에 넘긴다 — 순수 클라이언트 기능이다.
   */
  const emitWithAck = useCallback(
    (id: string, payload: ChatMessageOutgoing) => {
      const socket = socketRef.current;
      if (!socket) {
        // CHAT_ENABLED가 false라 소켓 자체가 없는 로컬 전용 모드 — 원래도 낙관적
        // 표시만 하던 경로라 실패로 표시하지 않는다.
        setMessageStatus(id, undefined);
        return;
      }
      pendingIdRef.current = id;
      socket
        .timeout(ACK_TIMEOUT_MS)
        .emit('chat:message', payload, (err: Error | null) => {
          if (pendingIdRef.current === id) pendingIdRef.current = null;
          setMessageStatus(id, err ? 'failed' : undefined);
        });
    },
    [setMessageStatus],
  );

  /**
   * 실제로 낙관적 메시지를 추가했는지를 boolean으로 돌려준다. 호출부(ChatScreen)가
   * 이 값을 보고 성공했을 때만 입력창을 비우게 하기 위함 — 그렇지 않으면 profile이
   * 세션 갱신 중 잠깐 비어 아무 일도 안 일어났는데도 사용자가 쓴 내용이 조용히
   * 사라진다(PR #50 리뷰 지적 1번).
   */
  const sendMessage = useCallback(
    (text: string): boolean => {
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > MAX_MESSAGE_LENGTH || !profile) return false;
      const id = makeId();
      // 서버가 발신자를 제외하고 릴레이하므로(PR #34), 내 메시지는 낙관적으로 직접
      // 추가한다. ack 결과가 오기 전까지는 'sending'으로 표시된다.
      addMessage({
        id,
        mine: true,
        userId: profile.id,
        nickname: profile.nickname,
        team: profile.team,
        text: trimmed,
        at: new Date().toISOString(),
        status: 'sending',
      });
      emitWithAck(id, { text: trimmed });
      return true;
    },
    [addMessage, emitWithAck, profile],
  );

  /** 실패 표시된 메시지를 같은 id로 다시 보낸다 — 새 말풍선을 만들지 않는다. */
  const retryMessage = useCallback(
    (item: ChatFeedItem) => {
      if (!item.mine || item.status !== 'failed') return;
      setMessageStatus(item.id, 'sending');
      emitWithAck(item.id, { text: item.text });
    },
    [emitWithAck, setMessageStatus],
  );

  return { sendMessage, retryMessage, chatError };
}
