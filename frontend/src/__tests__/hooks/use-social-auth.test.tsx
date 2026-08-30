import React from 'react';
import { renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useFinishSocialLogin } from '@/hooks/use-social-auth';
import { getMe } from '@/api/auth';

jest.mock('@/api/auth', () => ({ getMe: jest.fn() }));

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const mockedGetMe = getMe as jest.Mock;
const mockedUseRouter = useRouter as jest.Mock;

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
  it('약관에 동의하면 프로필 완성 화면으로 보낸다', async () => {
    mockedGetMe.mockResolvedValue(null);
    const push = jest.fn();
    mockedUseRouter.mockReturnValue({ replace: jest.fn(), push });
    const requestConsent = jest.fn().mockResolvedValue(true);

    const finishSocialLogin = await renderFinishSocialLogin(requestConsent);
    await finishSocialLogin();

    expect(requestConsent).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/(auth)/complete-profile');
  });

  it('약관 동의를 거부하면 아무 곳으로도 보내지 않는다', async () => {
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
  });
});
