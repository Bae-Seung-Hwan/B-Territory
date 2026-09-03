import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '@/lib/api-client';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
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
 * `/chat` 네임스페이스(PR #34, develop에 이미 merge됨) 전용 소켓. 앱이 포그라운드에
 * 있는 동안(다른 탭으로 이동한 것과 무관하게) connect 상태를 유지하고, 백그라운드로
 * 가면 disconnect한다(전역 SocketProvider와 분리된 독립 생명주기 — realtime 소켓
 * 작업과 서로 간섭하지 않는다).
 *
 * 이전에는 `useIsFocused()`로 "채팅 탭에 있을 때만" 연결했는데(PR #50 2차 리뷰 지적
 * 2번), `ChatGateway`가 메시지를 DB에 저장하지 않는 순수 릴레이라 그 방식은 다른
 * 탭에 잠깐만 있어도 그 사이 온 팀 메시지가 영영 사라지는 결과를 냈다 — 스토어가
 * `MAX_MESSAGES`로 상한이 걸려 있어 "계속 쌓인다"는 애초에 걱정할 문제가 아니었다
 * (PR #50 3차 리뷰 지적 3번). 판정 기준을 앱 전체의 포그라운드 여부(`AppState`)로
 * 옮겨, 탭을 오가는 동안은 연결을 유지하고 앱이 실제로 백그라운드로 갈 때만 끊는다.
 */
export function useChatSocket() {
  const socketRef = useRef<Socket | null>(null);
  // exception이 어떤 emit을 거부한 것인지 서버가 알려주지 않는다({ code }만 온다) —
  // 레이트리밋은 그 순간 보낸 메시지가 임계값을 넘겨서 걸리므로, 가장 최근에 보낸
  // ack 대기 중 메시지가 거부 대상이라고 본다. 두 메시지가 동시에 대기 중인 드문
  // 경우엔 더 이전 메시지를 잘못 짚을 수 있지만, 그래도 ACK_TIMEOUT_MS 시점에는
  // 결국 failed로 정리된다.
  const pendingIdRef = useRef<string | null>(null);
  // 메시지 id별 "몇 번째 전송 시도인지"를 센다. retryMessage는 같은 id로 다시
  // emitWithAck를 부르는데, 원래 시도의 ack/타임아웃 콜백이 그 이후에(레이트리밋으로
  // 인한 뒤늦은 타임아웃, 혹은 아래 disconnect가 강제로 발화시키는 에러) 도착하면
  // 이미 새 시도가 정한 상태(성공/전송 중)를 덮어쓴다 — 정상 전달된 메시지가 다시
  // "전송 실패"로 표시되고, 사용자가 그걸 보고 또 재전송하면 팀 채팅에 같은 메시지가
  // 두 번 나간다(PR #50 3차 리뷰 지적 1·2번). 콜백은 자신이 속한 시도가 여전히 그
  // 메시지의 최신 시도일 때만 상태를 반영한다.
  const attemptRef = useRef<Map<string, number>>(new Map());
  const addMessage = useChatStore((s) => s.addMessage);
  const setMessageStatus = useChatStore((s) => s.setMessageStatus);
  const { profile, isAuthenticated } = useAuth();
  const [chatError, setChatError] = useState<ChatSocketError | null>(null);
  const [isForeground, setIsForeground] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setIsForeground(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  // isAuthenticated에 의존해야 한다 — 마운트 시점에 Firebase 세션 복원이 아직 끝나지
  // 않았으면 auth.currentUser가 null이라 토큰을 못 읽는데, 이 값을 안 보면 세션이
  // 도착해도 effect가 다시 돌지 않아 영영 연결되지 않는다.
  useEffect(() => {
    if (!isAuthenticated || !isForeground) return;

    // attemptRef.current(Map)는 이 훅 생애주기 동안 재할당되지 않는 안정된 참조라,
    // cleanup에서 그대로 다시 읽어도 최신 상태를 본다 — effect 시작 시점에 변수로
    // 캡처해두는 건 오직 react-hooks/exhaustive-deps가 "cleanup에서 직접
    // attemptRef.current를 읽으면 그 사이 바뀌었을 수 있다"고 오탐하는 것을 피하기
    // 위함이다.
    const attemptMap = attemptRef.current;

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
      // disconnect()는 socket.io-client 내부에서 대기 중이던 ack을 즉시 Error로
      // 강제 발화시킨다(_clearAcks). 하지만 채팅 핸들러는 ack을 돌려주기 전에 이미
      // 동기적으로 릴레이를 마치므로, 그 순간 대기 중이던 메시지는 실제로는 대부분
      // 전달됐다 — 강제 에러를 그대로 믿으면 정상 전달된 메시지가 "전송 실패"로
      // 표시되고, 사용자가 재전송하면 팀 채팅에 같은 메시지가 두 번 나간다(PR #50
      // 3차 리뷰 지적 2번). 여기서 먼저 성공으로 확정하고 시도 번호를 올려두면,
      // disconnect()가 강제로 발화시키는 낡은 콜백은 emitWithAck의 시도 검사에
      // 걸려 무시된다.
      const pendingId = pendingIdRef.current;
      if (pendingId) {
        pendingIdRef.current = null;
        attemptMap.set(pendingId, (attemptMap.get(pendingId) ?? 0) + 1);
        setMessageStatus(pendingId, undefined);
      }
      socket.disconnect();
      socketRef.current = null;
    };
  }, [addMessage, isAuthenticated, isForeground, setMessageStatus]);

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
      const attempt = (attemptRef.current.get(id) ?? 0) + 1;
      attemptRef.current.set(id, attempt);
      const socket = socketRef.current;
      if (!socket) {
        // 소켓이 없다는 것은 실제로 아무것도 전송되지 않았다는 뜻이다(인증/포그라운드
        // 조건이 아직 안 갖춰졌거나 재연결 대기 중) — 성공으로 표시하면 이 PR이 500자
        // 제한·ack 확인으로 막은 것과 같은 "조용한 유실"이 여기 남는다(PR #50 3차
        // 리뷰 지적 4번).
        setMessageStatus(id, 'failed');
        return;
      }
      pendingIdRef.current = id;
      socket
        .timeout(ACK_TIMEOUT_MS)
        .emit('chat:message', payload, (err: Error | null) => {
          if (pendingIdRef.current === id) pendingIdRef.current = null;
          // 이 콜백이 만들어진 이후 같은 id로 재전송(retryMessage)됐거나 disconnect가
          // 먼저 확정 지었으면, attemptRef의 시도 번호가 이미 올라가 있다 — 그 경우
          // 이 낡은 콜백은 무시한다(PR #50 3차 리뷰 지적 1·2번).
          if (attemptRef.current.get(id) !== attempt) return;
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
