import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDeleteAccountMutation } from '@/hooks/use-account';
import * as accountApi from '@/api/account';

jest.mock('@/api/account', () => ({ deleteAccount: jest.fn() }));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('useDeleteAccountMutation', () => {
  let queryClient: QueryClient;

  afterEach(() => {
    queryClient.clear();
    jest.clearAllMocks();
  });

  it('mutate를 호출하면 deleteAccount API를 호출하고 성공 상태가 된다', async () => {
    (accountApi.deleteAccount as jest.Mock).mockResolvedValue(undefined);
    queryClient = createQueryClient();

    const { result } = await renderHook(() => useDeleteAccountMutation(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(accountApi.deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('실패하면 에러 상태가 되고 onError 콜백이 그 에러를 받는다', async () => {
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
