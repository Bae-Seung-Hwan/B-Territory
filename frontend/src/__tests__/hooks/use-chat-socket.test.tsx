import { act, renderHook } from '@testing-library/react-native';
import { useIsFocused } from 'expo-router';
import { io } from 'socket.io-client';
import { useChatSocket } from '@/hooks/use-chat-socket';
import { useChatStore } from '@/store/useChatStore';
import { useAuth } from '@/hooks/use-auth';

jest.mock('@/config/feature-flags', () => ({ CHAT_ENABLED: true }));
jest.mock('@/lib/firebase', () => ({
  auth: { currentUser: { getIdToken: jest.fn().mockResolvedValue('token') } },
}));
jest.mock('@/hooks/use-auth', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useIsFocused: jest.fn(() => true) }));

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
const mockedUseIsFocused = useIsFocused as jest.Mock;

const profile = { id: 'u1', email: 'a@b.com', nickname: 'nick', nationality: 'KR', team: 'KR' };

describe('useChatSocket', () => {
  let fakeSocket: ReturnType<typeof createFakeSocket>;

  beforeEach(() => {
    jest.clearAllMocks();
    fakeSocket = createFakeSocket();
    mockedIo.mockReturnValue(fakeSocket);
    mockedUseAuth.mockReturnValue({ profile, isAuthenticated: true });
    mockedUseIsFocused.mockReturnValue(true);
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

  it('탭이 포커스를 잃으면 소켓을 disconnect하고, 다시 포커스를 받으면 재연결한다 (PR #50 2차 리뷰 지적 2번)', async () => {
    mockedUseIsFocused.mockReturnValue(true);
    const { rerender, unmount } = await renderHook(() => useChatSocket());

    expect(mockedIo).toHaveBeenCalledTimes(1);
    expect(fakeSocket.connect).toHaveBeenCalledTimes(1);

    mockedUseIsFocused.mockReturnValue(false);
    await act(async () => rerender());
    expect(fakeSocket.disconnect).toHaveBeenCalledTimes(1);

    mockedUseIsFocused.mockReturnValue(true);
    await act(async () => rerender());
    expect(mockedIo).toHaveBeenCalledTimes(2);

    await act(async () => unmount());
  });
});
