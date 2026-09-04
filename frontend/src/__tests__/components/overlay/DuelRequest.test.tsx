import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import { DuelRequest } from '@/components/overlay/DuelRequest';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useSocket } from '@/providers/SocketProvider';

jest.mock('@/providers/SocketProvider', () => ({ useSocket: jest.fn() }));

const mockedUseSocket = useSocket as jest.Mock;
const initialState = useOverlayStore.getState();

function createFakeSocket() {
  const emitWithAck = jest.fn();
  return {
    emit: jest.fn(),
    timeout: jest.fn(() => ({ emit: emitWithAck })),
    __emitWithAck: emitWithAck,
  };
}

describe('DuelRequest', () => {
  let fakeSocket: ReturnType<typeof createFakeSocket>;
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    useOverlayStore.setState(initialState, true);
    useOverlayStore.getState().setDuelId(1);
    useOverlayStore.getState().setChallengerNickname('tlgus');
    useOverlayStore.getState().setShowDuelRequest(true);
    fakeSocket = createFakeSocket();
    mockedUseSocket.mockReturnValue(fakeSocket);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('수락을 누르면 대기 화면으로 바뀌고 .timeout()으로 duel:accept를 보낸다', async () => {
    const { getByText } = await render(<DuelRequest />);

    await act(async () => {
      fireEvent.press(getByText('Accept'));
    });

    expect(useOverlayStore.getState().showDuelRequest).toBe(false);
    expect(useOverlayStore.getState().showDuelPending).toBe(true);
    expect(fakeSocket.timeout).toHaveBeenCalledWith(5000);
    expect(fakeSocket.__emitWithAck).toHaveBeenCalledWith(
      'duel:accept',
      { duelId: 1 },
      expect.any(Function),
    );
  });

  it(
    '미니게임 시작 실패 ack(status: error)를 받으면 결투를 정리하고 알린다 ' +
      '(PR #54 리뷰 지적 3번 — 예전엔 콜백 자체가 없어 이 값을 아무도 읽지 않았다)',
    async () => {
      const { getByText } = await render(<DuelRequest />);
      await act(async () => {
        fireEvent.press(getByText('Accept'));
      });

      const ack = fakeSocket.__emitWithAck.mock.calls[0][2] as (
        err: Error | null,
        ack?: { status: string; code?: string; message?: string },
      ) => void;
      await act(async () => {
        ack(null, { status: 'error', code: 'MINIGAME_START_FAILED', message: '실패' });
      });

      expect(useOverlayStore.getState().duelId).toBeNull();
      expect(useOverlayStore.getState().showDuelPending).toBe(false);
      expect(alertSpy).toHaveBeenCalledTimes(1);
    },
  );

  it('타임아웃(서버가 어떤 이유로든 응답하지 않음)이면 결투를 정리하고 알린다', async () => {
    const { getByText } = await render(<DuelRequest />);
    await act(async () => {
      fireEvent.press(getByText('Accept'));
    });

    const ack = fakeSocket.__emitWithAck.mock.calls[0][2] as (err: Error | null) => void;
    await act(async () => {
      ack(new Error('operation has timed out'));
    });

    expect(useOverlayStore.getState().duelId).toBeNull();
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('ack이 성공(status: ok)이면 아무 것도 정리하지 않는다', async () => {
    const { getByText } = await render(<DuelRequest />);
    await act(async () => {
      fireEvent.press(getByText('Accept'));
    });

    const ack = fakeSocket.__emitWithAck.mock.calls[0][2] as (
      err: Error | null,
      ack?: { status: string },
    ) => void;
    await act(async () => {
      ack(null, { status: 'ok' });
    });

    expect(useOverlayStore.getState().duelId).toBe(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
