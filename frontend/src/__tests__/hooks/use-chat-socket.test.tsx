import { act, renderHook, waitFor } from '@testing-library/react-native';
import { io } from 'socket.io-client';
import { useChatSocket } from '@/hooks/use-chat-socket';
import { useChatStore } from '@/store/useChatStore';
import { useAuth } from '@/hooks/use-auth';

jest.mock('@/config/feature-flags', () => ({ CHAT_ENABLED: true }));
jest.mock('@/lib/firebase', () => ({
  auth: { currentUser: { getIdToken: jest.fn().mockResolvedValue('token') } },
}));
jest.mock('@/hooks/use-auth', () => ({ useAuth: jest.fn() }));

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

  it('500자를 넘는 메시지는 아예 전송하지 않는다', async () => {
    const { result, unmount } = await renderHook(() => useChatSocket());

    await act(async () => {
      result.current.sendMessage('a'.repeat(501));
    });

    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(fakeSocket.__emitWithAck).not.toHaveBeenCalled();
    await act(async () => unmount());
  });
});
