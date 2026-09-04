import React from 'react';
import { render, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/providers/AuthProvider';
import { queryKeys } from '@/lib/query-keys';
import { useBattleStore } from '@/store/useBattleStore';
import { useOverlayStore } from '@/store/useOverlayStore';

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

const initialBattleState = useBattleStore.getState();
const initialOverlayState = useOverlayStore.getState();

describe('AuthProvider', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    authCallback = null;
    queryClient = new QueryClient();
    useBattleStore.setState(initialBattleState, true);
    useOverlayStore.setState(initialOverlayState, true);
  });

  it(
    '사용자가 바뀌면(로그아웃·계정 전환) 이전 사용자 주변의 배틀 목록과 진행 중이던 ' +
      '결투 상태를 지운다 (PR #54 리뷰 지적 10번 — 남아 있던 duelId가 isDuelBusy를 ' +
      '참으로 만들어 새 사용자에게 온 duel:requested를 조용히 삼켰다)',
    async () => {
      queryClient.setQueryData(queryKeys.auth.me, { id: 'old-profile' });
      useBattleStore.getState().upsertEnemy({ userId: 'nearby-1', nickname: 'A', team: 'KR' });
      useOverlayStore.getState().setDuelId(7);
      useOverlayStore.getState().setShowMiniGame(true);

      await render(<Wrapper queryClient={queryClient} />);

      // 첫 이벤트: 이전 사용자가 없던 상태(undefined) -> A로 로그인. 지울 대상이
      // 애초에 없으므로 건드리지 않는다.
      await act(async () => authCallback?.({ uid: 'A' }));
      expect(Object.keys(useBattleStore.getState().enemiesById)).toHaveLength(1);
      expect(useOverlayStore.getState().duelId).toBe(7);

      // 계정 전환: A -> B.
      await act(async () => authCallback?.({ uid: 'B' }));

      expect(queryClient.getQueryData(queryKeys.auth.me)).toBeUndefined();
      expect(useBattleStore.getState().enemiesById).toEqual({});
      expect(useBattleStore.getState().pendingChallengeTargetId).toBeNull();
      expect(useOverlayStore.getState().duelId).toBeNull();
      expect(useOverlayStore.getState().showMiniGame).toBe(false);
    },
  );

  it('로그인·회원가입(이전 사용자 없음 -> 새 사용자)에서는 배틀·오버레이 상태를 지우지 않는다', async () => {
    useBattleStore.getState().upsertEnemy({ userId: 'nearby-1', nickname: 'A', team: 'KR' });

    await render(<Wrapper queryClient={queryClient} />);
    await act(async () => authCallback?.({ uid: 'A' }));

    expect(Object.keys(useBattleStore.getState().enemiesById)).toHaveLength(1);
  });
});
