import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { sendEmailVerification } from 'firebase/auth';
import { useSendFirebaseVerificationEmail } from '@/hooks/use-firebase-email-verification';

jest.mock('firebase/auth', () => ({
  sendEmailVerification: jest.fn(),
}));

const mockedSend = sendEmailVerification as jest.Mock;
const fakeUser = { uid: 'u1' } as never;

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSendFirebaseVerificationEmail', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.useFakeTimers();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    jest.useRealTimers();
    queryClient.clear();
    jest.clearAllMocks();
  });

  it('발송에 성공하면 60초 쿨다운이 시작되고 시간이 지나면 풀린다', async () => {
    mockedSend.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useSendFirebaseVerificationEmail(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.cooldown).toBe(0);

    await act(async () => {
      await result.current.sendVerificationEmail(fakeUser);
    });

    expect(mockedSend).toHaveBeenCalledWith(fakeUser);
    expect(result.current.cooldown).toBe(60);

    await act(async () => {
      jest.advanceTimersByTime(59_000);
    });
    expect(result.current.cooldown).toBe(1);

    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(result.current.cooldown).toBe(0);
  });

  it('auth/too-many-requests면 쿨다운을 건다 (Firebase가 이미 락을 잡은 상태)', async () => {
    mockedSend.mockRejectedValue(Object.assign(new Error('fail'), { code: 'auth/too-many-requests' }));

    const { result } = await renderHook(() => useSendFirebaseVerificationEmail(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await expect(result.current.sendVerificationEmail(fakeUser)).rejects.toThrow('fail');
    });

    expect(result.current.cooldown).toBe(60);
  });

  it('그 외 에러(네트워크 오류 등)는 서버 도달 여부를 알 수 없으므로 쿨다운을 걸지 않는다', async () => {
    mockedSend.mockRejectedValue(
      Object.assign(new Error('fail'), { code: 'auth/network-request-failed' }),
    );

    const { result } = await renderHook(() => useSendFirebaseVerificationEmail(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await expect(result.current.sendVerificationEmail(fakeUser)).rejects.toThrow('fail');
    });

    expect(result.current.cooldown).toBe(0);
  });
});

// 쿨다운 카운트다운과 달리 여기서는 프로미스 정착 순서를 봐야 해서 실제 타이머를 쓴다.
describe('useSendFirebaseVerificationEmail 연타', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    queryClient.clear();
    jest.clearAllMocks();
  });

  it('진행 중인 요청이 있으면 겹친 호출은 큐에 쌓지 않고 버린다', async () => {
    let resolveSend: () => void = () => {};
    mockedSend.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );

    const { result } = await renderHook(() => useSendFirebaseVerificationEmail(), {
      wrapper: createWrapper(queryClient),
    });

    // 버튼 disabled가 리렌더로 반영되기 전에 두 번째 press가 들어온 상황
    const first = result.current.sendVerificationEmail(fakeUser);
    const second = result.current.sendVerificationEmail(fakeUser);

    await expect(second).resolves.toBe(false);

    await act(async () => {
      resolveSend();
      await first;
    });

    await expect(first).resolves.toBe(true);
    // 겹친 호출이 나중에 따로 나가지도 않는다
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });
});
