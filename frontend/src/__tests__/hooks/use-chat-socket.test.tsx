import { act, renderHook } from '@testing-library/react-native';
import { io } from 'socket.io-client';
import { useChatSocket } from '@/hooks/use-chat-socket';
import { useChatStore } from '@/store/useChatStore';
import { useAuth } from '@/hooks/use-auth';

jest.mock('@/lib/firebase', () => ({
  auth: { currentUser: { getIdToken: jest.fn().mockResolvedValue('token') } },
}));
jest.mock('@/hooks/use-auth', () => ({ useAuth: jest.fn() }));

// AppState.currentState는 네이티브 모듈에서 오는 값이라 테스트 환경엔 없다. 훅이
// 구독하는 'change' 리스너를 붙잡아뒀다가 테스트에서 직접 호출해 포그라운드/
// 백그라운드 전환을 흉내낸다(PR #50 3차 리뷰 지적 3번 — 탭 포커스가 아니라 앱
// 전체의 포그라운드 여부로 연결을 유지한다). react-native/index.js가 AppState를
// `require('./Libraries/AppState/AppState').default`로 지연 로드하므로, 'react-native'
// 전체가 아니라 이 서브모듈 하나만 목킹한다 — 통째로 바꾸면(jest.requireActual 포함)
// 이 환경엔 없는 네이티브 모듈(DevMenu 등)까지 초기화를 시도해 깨진다.
const mockAppState: { currentState: string; listener: ((state: string) => void) | null } = {
  currentState: 'active',
  listener: null,
};
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: {
    get currentState() {
      return mockAppState.currentState;
    },
    addEventListener: jest.fn((_type: string, cb: (state: string) => void) => {
      mockAppState.listener = cb;
      return { remove: jest.fn() };
    }),
  },
}));

function setAppState(state: 'active' | 'inactive' | 'background') {
  mockAppState.currentState = state;
  mockAppState.listener?.(state);
}

type AckCallback = (err: Error | null, response?: { status: string }) => void;

function createFakeSocket() {
  const handlers = new Map<string, (payload: unknown) => void>();
  const emitWithAck = jest.fn();
  return {
    on: jest.fn((event: string, cb: (payload: unknown) => void) => {
      handlers.set(event, cb);
    }),
    connect: jest.fn(() => handlers.get('connect')?.(undefined)),
    disconnect: jest.fn(),
    timeout: jest.fn(() => ({ emit: emitWithAck })),
    // 테스트에서 emit(event, payload, ack) 호출을 검사/트리거하기 위한 헬퍼
    __emitWithAck: emitWithAck,
    // 테스트에서 'exception' 등 서버 emit을 직접 트리거하기 위한 헬퍼
    __handlers: handlers,
  };
}

jest.mock('socket.io-client', () => ({ io: jest.fn() }));

const mockedUseAuth = useAuth as jest.Mock;
const mockedIo = io as unknown as jest.Mock;

const profile = { id: 'u1', email: 'a@b.com', nickname: 'nick', nationality: 'KR', team: 'KR' };

describe('useChatSocket', () => {
  let fakeSocket: ReturnType<typeof createFakeSocket>;

  beforeEach(() => {
    jest.clearAllMocks();
    fakeSocket = createFakeSocket();
    mockedIo.mockReturnValue(fakeSocket);
    mockedUseAuth.mockReturnValue({ profile, isAuthenticated: true });
    mockAppState.currentState = 'active';
    mockAppState.listener = null;
    useChatStore.getState().clear();
  });

  it('ack이 성공으로 오면 낙관적으로 추가한 메시지의 status를 지운다', async () => {
    const { result, unmount } = await renderHook(() => useChatSocket());

    await act(async () => {
      result.current.sendMessage('안녕');
    });

    const [msg] = useChatStore.getState().messages;
    expect(msg.status).toBe('sending');
    expect(msg.text).toBe('안녕');

    const ack: AckCallback = fakeSocket.__emitWithAck.mock.calls[0][2];
    await act(async () => {
      ack(null, { status: 'ok' });
    });

    expect(useChatStore.getState().messages[0].status).toBeUndefined();
    await act(async () => unmount());
  });

  it('ack이 타임아웃 에러로 오면(레이트리밋 등) status를 failed로 표시한다', async () => {
    const { result, unmount } = await renderHook(() => useChatSocket());

    await act(async () => {
      result.current.sendMessage('스팸');
    });

    const ack: AckCallback = fakeSocket.__emitWithAck.mock.calls[0][2];
    await act(async () => {
      ack(new Error('operation has timed out'));
    });

    expect(useChatStore.getState().messages[0].status).toBe('failed');
    await act(async () => unmount());
  });

  it('retryMessage는 같은 id로 다시 emit하고 성공하면 failed가 풀린다', async () => {
    const { result, unmount } = await renderHook(() => useChatSocket());

    await act(async () => {
      result.current.sendMessage('실패했다 성공하는 메시지');
    });
    const failAck: AckCallback = fakeSocket.__emitWithAck.mock.calls[0][2];
    await act(async () => {
      failAck(new Error('timeout'));
    });
    expect(useChatStore.getState().messages[0].status).toBe('failed');
    const failedItem = useChatStore.getState().messages[0];

    await act(async () => {
      result.current.retryMessage(failedItem);
    });
    expect(useChatStore.getState().messages).toHaveLength(1); // 새 말풍선을 만들지 않는다
    expect(useChatStore.getState().messages[0].id).toBe(failedItem.id);
    expect(useChatStore.getState().messages[0].status).toBe('sending');

    const retryAck: AckCallback = fakeSocket.__emitWithAck.mock.calls[1][2];
    await act(async () => {
      retryAck(null, { status: 'ok' });
    });

    expect(useChatStore.getState().messages[0].status).toBeUndefined();
    await act(async () => unmount());
  });

  it(
    '재전송이 성공한 뒤 원래(첫 번째) 시도의 낡은 ack이 뒤늦게 도착해도 성공 상태를 ' +
      '덮어쓰지 않는다 (PR #50 3차 리뷰 지적 1번)',
    async () => {
      const { result, unmount } = await renderHook(() => useChatSocket());

      await act(async () => {
        result.current.sendMessage('레이트리밋에 걸렸다가 재전송하는 메시지');
      });
      const originalAck: AckCallback = fakeSocket.__emitWithAck.mock.calls[0][2];
      await act(async () => {
        originalAck(new Error('timeout'));
      });
      const failedItem = useChatStore.getState().messages[0];
      expect(failedItem.status).toBe('failed');

      await act(async () => {
        result.current.retryMessage(failedItem);
      });
      const retryAck: AckCallback = fakeSocket.__emitWithAck.mock.calls[1][2];
      await act(async () => {
        retryAck(null, { status: 'ok' });
      });
      expect(useChatStore.getState().messages[0].status).toBeUndefined();

      // 원래 emit의 타임아웃이 이제 와서(재전송이 이미 성공한 뒤) 뒤늦게 발화한다.
      // 시도 번호 가드가 없으면 이 낡은 콜백이 방금 성공한 메시지를 다시 failed로
      // 되돌리고, 사용자가 그걸 보고 또 재전송하면 팀 채팅에 같은 메시지가 두 번 나간다.
      await act(async () => {
        originalAck(new Error('timeout'));
      });
      expect(useChatStore.getState().messages[0].status).toBeUndefined();

      await act(async () => unmount());
    },
  );

  it('500자를 넘는 메시지는 아예 전송하지 않고 false를 돌려준다', async () => {
    const { result, unmount } = await renderHook(() => useChatSocket());

    let sent = true;
    await act(async () => {
      sent = result.current.sendMessage('a'.repeat(501));
    });

    expect(sent).toBe(false);
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(fakeSocket.__emitWithAck).not.toHaveBeenCalled();
    await act(async () => unmount());
  });

  it('profile이 없으면 전송하지 않고 false를 돌려준다 (PR #50 리뷰 지적 1번)', async () => {
    // 세션 갱신·캐시 무효화 순간 profile이 잠깐 undefined가 되는 창을 재현한다.
    // 호출부(ChatScreen)가 이 반환값으로 입력을 지울지 말지 판단한다.
    mockedUseAuth.mockReturnValue({ profile: undefined, isAuthenticated: true });
    const { result, unmount } = await renderHook(() => useChatSocket());

    let sent = true;
    await act(async () => {
      sent = result.current.sendMessage('안녕');
    });

    expect(sent).toBe(false);
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(fakeSocket.__emitWithAck).not.toHaveBeenCalled();
    await act(async () => unmount());
  });

  it('정상 전송 시 true를 돌려준다', async () => {
    const { result, unmount } = await renderHook(() => useChatSocket());

    let sent = false;
    await act(async () => {
      sent = result.current.sendMessage('안녕');
    });

    expect(sent).toBe(true);
    await act(async () => unmount());
  });

  it(
    '소켓이 없는 상태(포그라운드 조건이 아직 안 갖춰짐)에서 보내면 실패로 표시한다 — ' +
      '성공으로 위장하지 않는다 (PR #50 3차 리뷰 지적 4번)',
    async () => {
      // 이전에는 CHAT_ENABLED가 false일 때만 이 경로를 탔고 "로컬 전용 모드"라는
      // 이유로 성공으로 표시했다. 그 플래그가 사라진 지금은 소켓이 없다는 것이
      // 곧 "아무것도 전송되지 않았다"는 뜻이라, 실패로 표시해야 조용한 유실을
      // 막을 수 있다.
      mockAppState.currentState = 'background';
      const { result, unmount } = await renderHook(() => useChatSocket());
      expect(mockedIo).not.toHaveBeenCalled();

      await act(async () => {
        result.current.sendMessage('아직 연결 전에 보낸 메시지');
      });

      expect(useChatStore.getState().messages[0].status).toBe('failed');
      expect(fakeSocket.__emitWithAck).not.toHaveBeenCalled();
      await act(async () => unmount());
    },
  );

  it('exception이 오면 ack 타임아웃을 기다리지 않고 즉시 failed로 표시한다 (PR #50 2차 리뷰 지적 1번)', async () => {
    const { result, unmount } = await renderHook(() => useChatSocket());

    await act(async () => {
      result.current.sendMessage('레이트리밋에 걸리는 메시지');
    });
    expect(useChatStore.getState().messages[0].status).toBe('sending');

    await act(async () => {
      fakeSocket.__handlers.get('exception')?.({ code: 'CHAT_RATE_LIMIT' });
    });

    // ack 콜백(fakeSocket.__emitWithAck)을 아직 한 번도 호출하지 않았는데도 실패로
    // 표시돼야 한다 — ACK_TIMEOUT_MS까지 기다리지 않았다는 뜻이다.
    expect(useChatStore.getState().messages[0].status).toBe('failed');
    await act(async () => unmount());
  });

  it(
    '앱이 백그라운드로 가면 소켓을 disconnect하고, 다시 포그라운드로 돌아오면 ' +
      '재연결한다 (PR #50 3차 리뷰 지적 3번 — 탭 전환이 아니라 앱 전체 백그라운드 기준)',
    async () => {
      const { unmount } = await renderHook(() => useChatSocket());

      expect(mockedIo).toHaveBeenCalledTimes(1);
      expect(fakeSocket.connect).toHaveBeenCalledTimes(1);

      await act(async () => setAppState('background'));
      expect(fakeSocket.disconnect).toHaveBeenCalledTimes(1);

      await act(async () => setAppState('active'));
      expect(mockedIo).toHaveBeenCalledTimes(2);

      await act(async () => unmount());
    },
  );

  it(
    '앱이 백그라운드로 갈 때 전송 중이던 메시지는 실패가 아니라 성공으로 확정하고, ' +
      '그 뒤 강제로 발화하는 낡은 ack은 무시한다 (PR #50 3차 리뷰 지적 2번)',
    async () => {
      const { result, unmount } = await renderHook(() => useChatSocket());

      await act(async () => {
        result.current.sendMessage('백그라운드 전환 중 대기하던 메시지');
      });
      expect(useChatStore.getState().messages[0].status).toBe('sending');
      const pendingAck: AckCallback = fakeSocket.__emitWithAck.mock.calls[0][2];

      // 채팅 핸들러는 ack을 돌려주기 전에 이미 동기적으로 릴레이를 마치므로, 대기
      // 중이던 메시지는 실제로는 대부분 전달됐다고 보고 성공으로 확정한다.
      await act(async () => setAppState('background'));
      expect(fakeSocket.disconnect).toHaveBeenCalledTimes(1);
      expect(useChatStore.getState().messages[0].status).toBeUndefined();

      // socket.io-client의 disconnect()는 대기 중이던 ack을 강제로 Error 발화시킨다
      // (_clearAcks). 시도 번호 가드가 없으면 이 낡은 콜백이 방금 확정한 성공을
      // 다시 failed로 되돌린다.
      await act(async () => {
        pendingAck(new Error('socket has been disconnected'));
      });
      expect(useChatStore.getState().messages[0].status).toBeUndefined();

      await act(async () => unmount());
    },
  );

  it(
    '앱이 백그라운드로 갈 때 대기 중인 메시지가 둘 이상이면 전부 성공으로 확정한다 ' +
      '(PR #50 4차 리뷰 지적 1번 — 단일 슬롯이던 pendingId를 집합으로 확장)',
    async () => {
      const { result, unmount } = await renderHook(() => useChatSocket());

      // 열악한 회선에서 앞 메시지의 ack이 오기 전에 다음 메시지를 보내면 둘 다 동시에
      // 대기 상태가 된다 — 단일 슬롯이면 나중 것만 기억해 앞 메시지가 구제에서 빠진다.
      await act(async () => {
        result.current.sendMessage('먼저 보낸 메시지');
      });
      await act(async () => {
        result.current.sendMessage('나중에 보낸 메시지');
      });
      expect(useChatStore.getState().messages).toHaveLength(2);
      expect(useChatStore.getState().messages[0].status).toBe('sending');
      expect(useChatStore.getState().messages[1].status).toBe('sending');

      const firstAck: AckCallback = fakeSocket.__emitWithAck.mock.calls[0][2];
      const secondAck: AckCallback = fakeSocket.__emitWithAck.mock.calls[1][2];

      await act(async () => setAppState('background'));
      expect(useChatStore.getState().messages[0].status).toBeUndefined();
      expect(useChatStore.getState().messages[1].status).toBeUndefined();

      // disconnect()가 강제 발화시키는 낡은 ack을 둘 다 나중에 받아도 무시해야 한다.
      await act(async () => {
        firstAck(new Error('socket has been disconnected'));
        secondAck(new Error('socket has been disconnected'));
      });
      expect(useChatStore.getState().messages[0].status).toBeUndefined();
      expect(useChatStore.getState().messages[1].status).toBeUndefined();

      await act(async () => unmount());
    },
  );

  it(
    "iOS의 'inactive' 전환은 백그라운드로 취급하지 않는다 " +
      '(PR #50 4차 리뷰 지적 2번 — 제어센터·앱 스위처 등으로 소켓이 불필요하게 끊기던 문제)',
    async () => {
      const { unmount } = await renderHook(() => useChatSocket());
      expect(mockedIo).toHaveBeenCalledTimes(1);

      await act(async () => setAppState('inactive'));
      expect(fakeSocket.disconnect).not.toHaveBeenCalled();

      await act(async () => setAppState('background'));
      expect(fakeSocket.disconnect).toHaveBeenCalledTimes(1);

      await act(async () => unmount());
    },
  );
});
