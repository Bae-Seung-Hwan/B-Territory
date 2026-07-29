import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth, useRegisterMutation } from '@/hooks/use-auth';
import { queryKeys } from '@/lib/query-keys';
import * as authApi from '@/api/auth';
import { useAuthSession } from '@/providers/AuthProvider';

jest.mock('@/api/auth', () => ({
  registerUser: jest.fn(),
  getMe: jest.fn(),
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuthSession: jest.fn(),
}));

const mockedUseAuthSession = useAuthSession as jest.Mock;

const profile = { id: '1', email: 'a@b.com', nickname: 'n', nationality: 'KR', team: 'KR' };

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('useRegisterMutation', () => {
  let queryClient: QueryClient;

  afterEach(() => {
    queryClient.clear();
    jest.clearAllMocks();
  });

  it('성공 시 registerUser를 호출하고 auth.me 캐시를 채운다', async () => {
    (authApi.registerUser as jest.Mock).mockResolvedValue(profile);

    queryClient = createQueryClient();
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

  it('먼저 시작된 auth.me 조회가 뒤늦게 null로 끝나도 가입 결과를 덮어쓰지 않는다', async () => {
    // 계정 생성 직후 AuthProvider가 띄우는 조회를 흉내낸다. 이 시점엔 백엔드 프로필이
    // 아직 없어 404 -> null이고, 등록 성공보다 늦게 resolve되는 상황이 레이스였다.
    let resolvePendingGetMe: (value: null) => void = () => {};
    (authApi.getMe as jest.Mock).mockImplementation(
      () =>
        new Promise<null>((resolve) => {
          resolvePendingGetMe = resolve;
        }),
    );
    (authApi.registerUser as jest.Mock).mockResolvedValue(profile);

    queryClient = createQueryClient();
    queryClient.prefetchQuery({ queryKey: queryKeys.auth.me, queryFn: authApi.getMe });

    const { result } = await renderHook(() => useRegisterMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ nickname: 'n', nationality: 'KR' });
    });

    await act(async () => {
      resolvePendingGetMe(null);
    });

    expect(queryClient.getQueryData(queryKeys.auth.me)).toEqual(profile);
  });
});

describe('useAuth', () => {
  let queryClient: QueryClient;

  afterEach(() => {
    queryClient.clear();
    jest.clearAllMocks();
  });

  function renderUseAuth() {
    queryClient = createQueryClient();
    return renderHook(() => useAuth(), { wrapper: createWrapper(queryClient) });
  }

  it('Firebase 세션이 없으면 조회하지 않고 미인증으로 본다', async () => {
    mockedUseAuthSession.mockReturnValue({ firebaseUser: null });

    const { result } = await renderUseAuth();

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isUnavailable).toBe(false);
    expect(authApi.getMe as jest.Mock).not.toHaveBeenCalled();
  });

  it('세션과 프로필이 모두 있으면 인증된 것으로 본다', async () => {
    mockedUseAuthSession.mockReturnValue({ firebaseUser: { uid: 'u1' } });
    (authApi.getMe as jest.Mock).mockResolvedValue(profile);

    const { result } = await renderUseAuth();

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(result.current.profile).toEqual(profile);
    expect(result.current.isUnavailable).toBe(false);
  });

  it('프로필이 404(null)면 미가입으로 보되 장애로 보지는 않는다', async () => {
    mockedUseAuthSession.mockReturnValue({ firebaseUser: { uid: 'u1' } });
    (authApi.getMe as jest.Mock).mockResolvedValue(null);

    const { result } = await renderUseAuth();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isUnavailable).toBe(false);
  });

  it('네트워크/5xx 실패는 미가입이 아니라 조회 불가로 구분한다', async () => {
    mockedUseAuthSession.mockReturnValue({ firebaseUser: { uid: 'u1' } });
    (authApi.getMe as jest.Mock).mockRejectedValue(new Error('network'));

    const { result } = await renderUseAuth();

    await waitFor(() => expect(result.current.isUnavailable).toBe(true));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });
});
