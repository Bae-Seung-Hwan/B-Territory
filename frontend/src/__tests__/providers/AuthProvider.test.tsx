import React from 'react';
import { render, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/providers/AuthProvider';
import { queryKeys } from '@/lib/query-keys';
import { useChatStore } from '@/store/useChatStore';

type AuthStateCallback = (user: { uid: string } | null) => void;

let authCallback: AuthStateCallback | null = null;

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn((_auth: unknown, cb: AuthStateCallback) => {
    authCallback = cb;
    return () => {
      authCallback = null;
    };
  }),
}));
jest.mock('@/lib/firebase', () => ({ auth: {} }));

function Wrapper({ queryClient }: { queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <></>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe('AuthProvider', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    authCallback = null;
    queryClient = new QueryClient();
    useChatStore.setState({ messages: [] });
  });

  it(
    '사용자가 바뀌면(로그아웃·계정 전환) 이전 사용자의 프로필·채팅·차단목록 캐시를 지운다 ' +
      '(PR #50 3차 리뷰 지적 6·7번)',
    async () => {
      queryClient.setQueryData(queryKeys.auth.me, { id: 'old-profile' });
      queryClient.setQueryData(queryKeys.moderation.blocks, [{ userId: 'x' }]);
      useChatStore.getState().addMessage({
        id: 'm1',
        userId: 'user-a',
        nickname: 'A',
        team: 'KR',
        text: '안녕',
        at: new Date().toISOString(),
        mine: false,
      });

      await render(<Wrapper queryClient={queryClient} />);

      // 첫 이벤트: 이전 사용자가 없던 상태(undefined) -> A로 로그인. 지울 대상이
      // 애초에 없으므로 캐시를 건드리지 않는다(로그인 화면이 방금 채운 프로필을
      // 여기서 지우면 불필요한 재조회가 생긴다).
      await act(async () => authCallback?.({ uid: 'A' }));
      expect(queryClient.getQueryData(queryKeys.auth.me)).toEqual({ id: 'old-profile' });
      expect(useChatStore.getState().messages).toHaveLength(1);

      // 계정 전환: A -> B. 직전 사용자(A)가 있었고 다음 사용자(B)와 다르므로 정리 대상이다.
      await act(async () => authCallback?.({ uid: 'B' }));

      expect(queryClient.getQueryData(queryKeys.auth.me)).toBeUndefined();
      expect(queryClient.getQueryData(queryKeys.moderation.blocks)).toBeUndefined();
      expect(useChatStore.getState().messages).toHaveLength(0);
    },
  );

  it('로그인·회원가입(이전 사용자 없음 -> 새 사용자)에서는 캐시를 지우지 않는다', async () => {
    queryClient.setQueryData(queryKeys.auth.me, { id: 'fresh-profile' });

    await render(<Wrapper queryClient={queryClient} />);

    await act(async () => authCallback?.({ uid: 'A' }));

    expect(queryClient.getQueryData(queryKeys.auth.me)).toEqual({ id: 'fresh-profile' });
  });
});
