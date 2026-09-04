import React from 'react';
import { Alert, Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { io } from 'socket.io-client';
import { SocketProvider } from '@/providers/SocketProvider';
import { useAuth } from '@/hooks/use-auth';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useBattleStore } from '@/store/useBattleStore';

jest.mock('socket.io-client', () => ({ io: jest.fn() }));
jest.mock('@/hooks/use-auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: jest.fn() } } }));

const mockedIo = io as unknown as jest.Mock;
const mockedUseAuth = useAuth as jest.Mock;

function createFakeSocket() {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    on: jest.fn((event: string, cb: (payload: unknown) => void) => handlers.set(event, cb)),
    off: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    __handlers: handlers,
  };
}

const initialOverlayState = useOverlayStore.getState();
const initialBattleState = useBattleStore.getState();

describe('SocketProvider', () => {
  let fakeSocket: ReturnType<typeof createFakeSocket>;
  let alertSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    useOverlayStore.setState(initialOverlayState, true);
    useBattleStore.setState(initialBattleState, true);
    fakeSocket = createFakeSocket();
    mockedIo.mockReturnValue(fakeSocket);
    mockedUseAuth.mockReturnValue({ isAuthenticated: true, profile: { id: 'me' } });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(
      <SocketProvider>
        <Text>child</Text>
      </SocketProvider>,
    );
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  function exceptionHandler(): (payload: { code: string; message: string }) => void {
    return fakeSocket.__handlers.get('exception') as (payload: {
      code: string;
      message: string;
    }) => void;
  }

  function duelRequestedHandler(): (payload: {
    duelId: number;
    fromUserId: string;
    fromNickname: string | null;
  }) => void {
    return fakeSocket.__handlers.get('duel:requested') as (payload: {
      duelId: number;
      fromUserId: string;
      fromNickname: string | null;
    }) => void;
  }

  it(
    'DUEL_ 접두사가 아닌 예외(location:update 검증 오류 등)는 Alert를 띄우지 않는다 ' +
      '(PR #54 리뷰 지적 2번 — 60초 하트비트마다 "결투 실패" 모달이 뜨던 문제)',
    async () => {
      useOverlayStore.getState().setDuelId(7);
      useOverlayStore.getState().setShowMiniGame(true);

      await act(async () => {
        exceptionHandler()({ code: 'INTERNAL_SERVER_ERROR', message: 'boom' });
      });

      expect(alertSpy).not.toHaveBeenCalled();
      // 결투와 무관한 예외라 진행 중이던 결투도 건드리지 않는다.
      expect(useOverlayStore.getState().duelId).toBe(7);
      expect(useOverlayStore.getState().showMiniGame).toBe(true);
    },
  );

  it('DUEL_ 접두사인 예외는 여전히 Alert를 띄운다', async () => {
    await act(async () => {
      exceptionHandler()({ code: 'DUEL_OUT_OF_RANGE', message: 'boom' });
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it(
    'duel:request 전용 실패 코드(DUEL_ALREADY_PENDING 등)는 이미 열려 있는 다른 결투를 ' +
      '지우지 않는다 (PR #54 리뷰 지적 4번)',
    async () => {
      // 남의 결투(수신자로서 받은 duel:requested)가 이미 열려 있다고 가정한다.
      useOverlayStore.getState().setDuelId(99);
      useOverlayStore.getState().setDuelRole('recipient');
      useOverlayStore.getState().setShowDuelRequest(true);

      await act(async () => {
        exceptionHandler()({ code: 'DUEL_ALREADY_PENDING', message: 'boom' });
      });

      expect(useOverlayStore.getState().duelId).toBe(99);
      expect(useOverlayStore.getState().showDuelRequest).toBe(true);
    },
  );

  it('duel:request 전용이 아닌 DUEL_ 코드(예: DUEL_NOT_ACCEPTED)는 지금 열려 있는 결투를 정리한다', async () => {
    useOverlayStore.getState().setDuelId(99);
    useOverlayStore.getState().setShowMiniGame(true);

    await act(async () => {
      exceptionHandler()({ code: 'DUEL_NOT_ACCEPTED', message: 'boom' });
    });

    expect(useOverlayStore.getState().duelId).toBeNull();
    expect(useOverlayStore.getState().showMiniGame).toBe(false);
  });

  it(
    '내 duel:request가 ack 대기 중일 때 도착한 duel:requested는 무시한다 ' +
      '(PR #54 리뷰 지적 5번 — 왕복 구간이 isDuelBusy에 안 잡혀 오버레이가 겹치던 문제)',
    async () => {
      useBattleStore.getState().setPendingChallengeTargetId('someone-else');

      await act(async () => {
        duelRequestedHandler()({ duelId: 1, fromUserId: 'c', fromNickname: 'C' });
      });

      expect(useOverlayStore.getState().showDuelRequest).toBe(false);
      expect(useOverlayStore.getState().duelId).toBeNull();
    },
  );

  it('요청이 진행 중이지 않으면 duel:requested를 정상적으로 받아들인다', async () => {
    await act(async () => {
      duelRequestedHandler()({ duelId: 1, fromUserId: 'c', fromNickname: 'C' });
    });

    expect(useOverlayStore.getState().showDuelRequest).toBe(true);
    expect(useOverlayStore.getState().duelId).toBe(1);
  });

  it(
    '신청이 거부되면 목록에서 지워졌던 상대를 되살린다 (PR #54 리뷰 지적 11번 — 예전엔 ' +
      '서버의 60초 재발송 쿨다운 동안 재도전할 방법이 없었다)',
    async () => {
      useOverlayStore.getState().setDuelId(5);
      useOverlayStore.getState().setDuelRole('challenger');
      useOverlayStore.getState().setEnemyInfo({
        userId: 'enemy-1',
        nickname: 'tlgus',
        nationality: 'JP',
        distance: 100,
      });

      await act(async () => {
        (fakeSocket.__handlers.get('duel:rejected') as (p: { duelId: number }) => void)({
          duelId: 5,
        });
      });

      expect(useBattleStore.getState().enemiesById['enemy-1']).toMatchObject({
        userId: 'enemy-1',
        nickname: 'tlgus',
        team: 'JP',
      });
    },
  );

  it('신청이 만료돼도 마찬가지로 되살린다', async () => {
    useOverlayStore.getState().setDuelId(5);
    useOverlayStore.getState().setDuelRole('challenger');
    useOverlayStore.getState().setEnemyInfo({
      userId: 'enemy-1',
      nickname: 'tlgus',
      nationality: 'JP',
      distance: 100,
    });

    await act(async () => {
      (fakeSocket.__handlers.get('duel:expired') as (p: { duelId: number }) => void)({ duelId: 5 });
    });

    expect(useBattleStore.getState().enemiesById['enemy-1']).toMatchObject({ userId: 'enemy-1' });
  });

  it('수신자(내가 거부한 쪽)는 배틀 목록을 건드리지 않는다', async () => {
    useOverlayStore.getState().setDuelId(5);
    useOverlayStore.getState().setDuelRole('recipient');
    useOverlayStore.getState().setEnemyInfo({
      userId: 'enemy-1',
      nickname: null,
      nationality: '',
      distance: 100,
    });

    await act(async () => {
      (fakeSocket.__handlers.get('duel:rejected') as (p: { duelId: number }) => void)({
        duelId: 5,
      });
    });

    expect(useBattleStore.getState().enemiesById).toEqual({});
  });
});
