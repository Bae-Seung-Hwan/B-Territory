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

  it('발송에 실패하면 쿨다운을 걸지 않아 바로 재시도할 수 있다', async () => {
    (emailApi.sendVerificationLink as jest.Mock).mockRejectedValue(new Error('boom'));

    const { result } = await renderHook(() => useSendVerificationLink(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await expect(result.current.sendLink('a@b.com')).rejects.toThrow('boom');
    });

    expect(result.current.cooldown).toBe(0);
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
