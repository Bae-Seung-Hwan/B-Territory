import React from 'react';
import { renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { useFinishSocialLogin } from '@/hooks/use-social-auth';
import { getMe } from '@/api/auth';

jest.mock('@/api/auth', () => ({ getMe: jest.fn() }));

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

jest.mock('firebase/auth', () => ({ signOut: jest.fn() }));

jest.mock('@/lib/firebase', () => ({ auth: {} }));

const mockedGetMe = getMe as jest.Mock;
const mockedUseRouter = useRouter as jest.Mock;
const mockedSignOut = signOut as jest.Mock;

const profile = { id: '1', email: 'a@b.com', nickname: 'n', nationality: 'KR', team: 'KR' };

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

async function renderFinishSocialLogin(requestConsent: jest.Mock) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = await renderHook(() => useFinishSocialLogin(requestConsent), {
    wrapper: createWrapper(queryClient),
  });
  return result.current;
}

describe('기존 유저(프로필 있음)', () => {
  it('약관 동의를 묻지 않고 곧장 홈으로 보낸다', async () => {
    mockedGetMe.mockResolvedValue(profile);
    const replace = jest.fn();
    mockedUseRouter.mockReturnValue({ replace, push: jest.fn() });
    const requestConsent = jest.fn().mockResolvedValue(true);

    const finishSocialLogin = await renderFinishSocialLogin(requestConsent);
    await finishSocialLogin();

    expect(requestConsent).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/');
  });
});

describe('신규 유저(프로필 없음)', () => {
  it('약관에 동의하면 프로필 완성 화면으로 보낸다 (백/스와이프로 돌아가지 못하도록 replace)', async () => {
    mockedGetMe.mockResolvedValue(null);
    const replace = jest.fn();
    mockedUseRouter.mockReturnValue({ replace, push: jest.fn() });
    const requestConsent = jest.fn().mockResolvedValue(true);

    const finishSocialLogin = await renderFinishSocialLogin(requestConsent);
    await finishSocialLogin();

    expect(requestConsent).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/(auth)/complete-profile');
  });

  it('약관 동의를 거부하면 아무 곳으로도 보내지 않고 Firebase 세션을 정리한다', async () => {
    mockedGetMe.mockResolvedValue(null);
    const replace = jest.fn();
    const push = jest.fn();
    mockedUseRouter.mockReturnValue({ replace, push });
    const requestConsent = jest.fn().mockResolvedValue(false);

    const finishSocialLogin = await renderFinishSocialLogin(requestConsent);
    await finishSocialLogin();

    expect(requestConsent).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(mockedSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('fetchQuery가 CancelledError로 실패할 때(계정 전환 레이스)', () => {
  it('다시 조회해 재시도된 결과로 정상 처리한다', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const replace = jest.fn();
    mockedUseRouter.mockReturnValue({ replace, push: jest.fn() });
    const requestConsent = jest.fn().mockResolvedValue(true);

    mockedGetMe.mockClear();
    mockedGetMe.mockResolvedValue(profile);
    const { result } = await renderHook(() => useFinishSocialLogin(requestConsent), {
      wrapper: createWrapper(queryClient),
    });

    // 첫 fetchQuery가 진행 중일 때 캐시를 비워 CancelledError를 유발한다
    // (AuthProvider가 계정 전환 시 removeQueries를 호출하는 것과 동일한 효과).
    const finishPromise = result.current();
    queryClient.removeQueries({ queryKey: ['auth', 'me'] });
    await finishPromise;

    // 첫 시도가 취소돼 재시도가 일어났다는 것은 호출 횟수 2회로 확인한다 —
    // 취소되지 않았다면 1회만 호출되고도 같은 최종 결과가 나올 수 있어서다.
    expect(mockedGetMe).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenCalledWith('/');
  });
});
