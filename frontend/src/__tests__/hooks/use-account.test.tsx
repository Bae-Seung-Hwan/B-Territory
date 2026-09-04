import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { useDeleteAccountMutation, isDeleteAccountSessionDead } from '@/hooks/use-account';
import * as accountApi from '@/api/account';

jest.mock('@/api/account', () => ({ deleteAccount: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('firebase/auth', () => ({ signOut: jest.fn() }));
jest.mock('@/lib/firebase', () => ({ auth: {} }));

const mockedUseRouter = useRouter as jest.Mock;
const mockedSignOut = signOut as jest.Mock;

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('isDeleteAccountSessionDead', () => {
  it('401은 세션이 죽은 것으로 본다', () => {
    expect(isDeleteAccountSessionDead({ isAxiosError: true, response: { status: 401 } })).toBe(
      true,
    );
  });

  it('타임아웃(ECONNABORTED)은 세션이 죽은 것으로 본다', () => {
    expect(isDeleteAccountSessionDead({ isAxiosError: true, code: 'ECONNABORTED' })).toBe(true);
  });

  it('그 외 상태 코드는 세션이 죽었다고 보지 않는다', () => {
    expect(isDeleteAccountSessionDead({ isAxiosError: true, response: { status: 500 } })).toBe(
      false,
    );
  });

  it('axios 에러가 아니면 세션이 죽었다고 보지 않는다', () => {
    expect(isDeleteAccountSessionDead(new Error('boom'))).toBe(false);
  });
});

describe('useDeleteAccountMutation', () => {
  let queryClient: QueryClient;
  let replace: jest.Mock;

  beforeEach(() => {
    replace = jest.fn();
    mockedUseRouter.mockReturnValue({ replace });
    mockedSignOut.mockResolvedValue(undefined);
  });

  afterEach(() => {
    queryClient.clear();
    jest.clearAllMocks();
  });

  it(
    '성공하면 signOut 후 로그인 화면으로 이동한다 — mutate() 인자가 아니라 훅 옵션에서 ' +
      '처리해야 화면 언마운트나 signOut 실패에도 반드시 실행된다 (PR #53 리뷰 지적 1·3번)',
    async () => {
      (accountApi.deleteAccount as jest.Mock).mockResolvedValue(undefined);
      queryClient = createQueryClient();

      const { result } = await renderHook(() => useDeleteAccountMutation(), {
        wrapper: createWrapper(queryClient),
      });

      result.current.mutate();

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedSignOut).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith('/(auth)/login');
    },
  );

  it('signOut이 실패해도 로그인 화면 이동은 반드시 실행된다', async () => {
    (accountApi.deleteAccount as jest.Mock).mockResolvedValue(undefined);
    mockedSignOut.mockRejectedValue(new Error('local signOut failed'));
    queryClient = createQueryClient();

    const { result } = await renderHook(() => useDeleteAccountMutation(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/(auth)/login'));
  });

  it(
    '401로 실패하면(계정이 이미 삭제된 뒤의 요청) 세션이 죽은 것으로 보고 signOut + ' +
      '로그인 화면 이동으로 정리한다 (PR #53 리뷰 지적 2번)',
    async () => {
      const err = { isAxiosError: true, response: { status: 401 } };
      (accountApi.deleteAccount as jest.Mock).mockRejectedValue(err);
      queryClient = createQueryClient();

      const { result } = await renderHook(() => useDeleteAccountMutation(), {
        wrapper: createWrapper(queryClient),
      });

      result.current.mutate();

      await waitFor(() => expect(result.current.isError).toBe(true));
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/(auth)/login'));
      expect(mockedSignOut).toHaveBeenCalledTimes(1);
    },
  );

  it(
    '타임아웃으로 실패해도(백엔드 처리가 apiClient 타임아웃보다 오래 걸림) 같은 정리로 ' +
      '빠진다 (PR #53 리뷰 지적 2번)',
    async () => {
      const err = { isAxiosError: true, code: 'ECONNABORTED' };
      (accountApi.deleteAccount as jest.Mock).mockRejectedValue(err);
      queryClient = createQueryClient();

      const { result } = await renderHook(() => useDeleteAccountMutation(), {
        wrapper: createWrapper(queryClient),
      });

      result.current.mutate();

      await waitFor(() => expect(result.current.isError).toBe(true));
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/(auth)/login'));
    },
  );

  it('세션이 죽은 게 아닌 실패(예: 500)에는 signOut·화면 이동을 하지 않는다', async () => {
    const err = { isAxiosError: true, response: { status: 500 } };
    (accountApi.deleteAccount as jest.Mock).mockRejectedValue(err);
    queryClient = createQueryClient();

    const { result } = await renderHook(() => useDeleteAccountMutation(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedSignOut).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('실패하면 에러 상태가 되고 mutate()의 onError 콜백이 그 에러를 받는다', async () => {
    const err = { isAxiosError: true, response: { status: 500 } };
    (accountApi.deleteAccount as jest.Mock).mockRejectedValue(err);
    queryClient = createQueryClient();

    const { result } = await renderHook(() => useDeleteAccountMutation(), {
      wrapper: createWrapper(queryClient),
    });

    const onError = jest.fn();
    result.current.mutate(undefined, { onError });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe(err);
  });
});
