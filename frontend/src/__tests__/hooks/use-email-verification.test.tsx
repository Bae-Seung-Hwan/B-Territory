import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSendVerificationLink, useVerifyEmailToken } from '@/hooks/use-email-verification';
import * as emailApi from '@/api/email';

jest.mock('@/api/email', () => ({
  sendVerificationLink: jest.fn(),
  verifyEmailToken: jest.fn(),
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSendVerificationLink', () => {
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
    (emailApi.sendVerificationLink as jest.Mock).mockResolvedValue(undefined);

    const { result } = await renderHook(() => useSendVerificationLink(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.cooldown).toBe(0);

    await act(async () => {
      await result.current.sendLink('a@b.com');
    });

    expect((emailApi.sendVerificationLink as jest.Mock).mock.calls[0][0]).toBe('a@b.com');
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

  // 백엔드는 메일을 보내기 전에 60초 락을 먼저 잡는다. 그래서 5xx·429여도 그동안
  // 재요청은 무조건 429다 — 클라이언트도 같이 잠가야 헛된 요청이 쌓이지 않는다.
  it.each([
    ['메일 발송 실패(5xx)', 500],
    ['쿨다운 미경과(429)', 429],
  ])('%s여도 쿨다운을 건다', async (_label, status) => {
    (emailApi.sendVerificationLink as jest.Mock).mockRejectedValue(
      Object.assign(new Error('fail'), { isAxiosError: true, response: { status } }),
    );

    const { result } = await renderHook(() => useSendVerificationLink(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await expect(result.current.sendLink('a@b.com')).rejects.toThrow('fail');
    });

    expect(result.current.cooldown).toBe(60);
  });

  // 400은 락을 잡기 전에 거부되고, 네트워크 오류는 서버 도달 여부를 알 수 없다.
  it.each([
    ['이메일 형식 오류(400)', { isAxiosError: true, response: { status: 400 } }],
    ['네트워크 오류', { isAxiosError: true, response: undefined }],
  ])('%s면 쿨다운을 걸지 않아 바로 다시 시도할 수 있다', async (_label, shape) => {
    (emailApi.sendVerificationLink as jest.Mock).mockRejectedValue(
      Object.assign(new Error('fail'), shape),
    );

    const { result } = await renderHook(() => useSendVerificationLink(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await expect(result.current.sendLink('a@b.com')).rejects.toThrow('fail');
    });

    expect(result.current.cooldown).toBe(0);
  });

});

// 쿨다운 카운트다운과 달리 여기서는 프로미스 정착 순서를 봐야 해서 실제 타이머를 쓴다.
describe('useSendVerificationLink 연타', () => {
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
    (emailApi.sendVerificationLink as jest.Mock).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );

    const { result } = await renderHook(() => useSendVerificationLink(), {
      wrapper: createWrapper(queryClient),
    });

    // 버튼 disabled가 리렌더로 반영되기 전에 두 번째 press가 들어온 상황
    const first = result.current.sendLink('a@b.com');
    const second = result.current.sendLink('a@b.com');

    await expect(second).resolves.toBe(false);

    await act(async () => {
      resolveSend();
      await first;
    });

    await expect(first).resolves.toBe(true);
    // 겹친 호출이 나중에 따로 나가지도 않는다
    expect((emailApi.sendVerificationLink as jest.Mock).mock.calls).toHaveLength(1);
  });
});

describe('useVerifyEmailToken', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    queryClient.clear();
    jest.clearAllMocks();
  });

  it('토큰을 검증해 이메일을 돌려준다', async () => {
    (emailApi.verifyEmailToken as jest.Mock).mockResolvedValue({
      email: 'a@b.com',
      verified: true,
    });

    const { result } = await renderHook(() => useVerifyEmailToken(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('tok');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ email: 'a@b.com', verified: true });
  });

  it('만료·무효 토큰은 자동 재시도 없이 한 번만 호출하고 실패한다', async () => {
    (emailApi.verifyEmailToken as jest.Mock).mockRejectedValue(new Error('invalid'));

    const { result } = await renderHook(() => useVerifyEmailToken(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('tok');

    await waitFor(() => expect(result.current.isError).toBe(true));
    // 토큰은 1회용이라 재시도가 붙으면 안 된다
    expect((emailApi.verifyEmailToken as jest.Mock).mock.calls).toHaveLength(1);
  });
});
