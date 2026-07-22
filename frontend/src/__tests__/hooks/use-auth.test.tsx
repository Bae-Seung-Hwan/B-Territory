import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRegisterMutation } from '@/hooks/use-auth';
import { queryKeys } from '@/lib/query-keys';
import * as authApi from '@/api/auth';

jest.mock('@/api/auth', () => ({
  registerUser: jest.fn(),
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useRegisterMutation', () => {
  let queryClient: QueryClient;

  afterEach(() => {
    queryClient.clear();
  });

  it('성공 시 registerUser를 호출하고 auth.me 캐시를 채운다', async () => {
    const profile = { id: '1', email: 'a@b.com', nickname: 'n', nationality: 'KR', team: 'KR' };
    (authApi.registerUser as jest.Mock).mockResolvedValue(profile);

    queryClient = new QueryClient();
    const { result } = await renderHook(() => useRegisterMutation(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ nickname: 'n', nationality: 'KR' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect((authApi.registerUser as jest.Mock).mock.calls[0][0]).toEqual({
      nickname: 'n',
      nationality: 'KR',
    });
    expect(queryClient.getQueryData(queryKeys.auth.me)).toEqual(profile);
  });
});
