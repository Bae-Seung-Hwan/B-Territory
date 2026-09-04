import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { BattleEnemyRow } from '@/components/battle/BattleEnemyRow';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useBattleStore } from '@/store/useBattleStore';

// 테스트 환경의 기본 locale은 en이다(expo-localization 목) — UI 문구 검증은 en.ts 값으로 한다.
const enemy = { userId: 'enemy-1', nickname: 'tlgus', team: 'JP' };
const enemy2 = { userId: 'enemy-2', nickname: 'tlfus', team: 'KR' };
const initialOverlayState = useOverlayStore.getState();
const initialBattleState = useBattleStore.getState();

function createFakeSocket() {
  const emitWithAck = jest.fn();
  return {
    emit: jest.fn(),
    timeout: jest.fn(() => ({ emit: emitWithAck })),
    __emitWithAck: emitWithAck,
  };
}

describe('BattleEnemyRow', () => {
  let fakeSocket: ReturnType<typeof createFakeSocket>;

  beforeEach(() => {
    jest.clearAllMocks();
    useOverlayStore.setState(initialOverlayState, true);
    useBattleStore.setState(initialBattleState, true);
    fakeSocket = createFakeSocket();
  });

  function renderRow(enemyPayload = enemy) {
    return render(
      <BattleEnemyRow
        enemy={enemyPayload}
        socket={fakeSocket as unknown as Parameters<typeof BattleEnemyRow>[0]['socket']}
      />,
    );
  }

  it('.timeout()으로 emit해 서버가 ack 없이 실패해도(예: throw) 최대 5초 뒤 스스로 정리된다', async () => {
    const { getByText, queryByText } = await renderRow();

    await act(async () => {
      fireEvent.press(getByText('Challenge'));
    });

    // pending 중에는 ActivityIndicator만 보이고 "Challenge" 텍스트는 사라진다.
    expect(fakeSocket.timeout).toHaveBeenCalledWith(5000);
    expect(fakeSocket.__emitWithAck).toHaveBeenCalledWith(
      'duel:request',
      { targetUserId: 'enemy-1' },
      expect.any(Function),
    );
    expect(queryByText('Challenge')).toBeNull();
    expect(useBattleStore.getState().pendingChallengeTargetId).toBe('enemy-1');

    // .timeout()이 걸려 있으므로, 서버가 throw로 끝나 ack이 전혀 안 와도(비-DUEL_ 코드거나
    // 소켓이 끊긴 경우) socket.io-client가 스스로 만든 타임아웃 에러가 이 콜백을 호출한다
    // (PR #54 리뷰 지적 1번) — 그 결과만 재현한다.
    const ackCallback = fakeSocket.__emitWithAck.mock.calls[0][2] as (
      err: Error | null,
      ack?: unknown,
    ) => void;
    await act(async () => {
      ackCallback(new Error('operation has timed out'));
    });

    expect(useBattleStore.getState().pendingChallengeTargetId).toBeNull();
    expect(getByText('Challenge')).toBeTruthy();
  });

  it('ack이 성공으로 오면 정상적으로 duel pending 오버레이를 열고 목록에서 상대를 지운다', async () => {
    const { getByText } = await renderRow();

    await act(async () => {
      fireEvent.press(getByText('Challenge'));
    });

    const ackCallback = fakeSocket.__emitWithAck.mock.calls[0][2] as (
      err: Error | null,
      ack: { status: string; duelId: number },
    ) => void;
    await act(async () => {
      ackCallback(null, { status: 'ok', duelId: 42 });
    });

    expect(useOverlayStore.getState().duelId).toBe(42);
    expect(useOverlayStore.getState().duelRole).toBe('challenger');
    expect(useOverlayStore.getState().enemyInfo).toEqual({
      userId: 'enemy-1',
      nickname: 'tlgus',
      nationality: 'JP',
      distance: expect.any(Number),
    });
    expect(useOverlayStore.getState().showDuelPending).toBe(true);
    expect(useBattleStore.getState().pendingChallengeTargetId).toBeNull();
  });

  it('한 행이 결투 신청 중이면 다른 행의 Challenge를 눌러도 요청이 나가지 않는다', async () => {
    const { getAllByText } = await render(
      <>
        <BattleEnemyRow
          enemy={enemy}
          socket={fakeSocket as unknown as Parameters<typeof BattleEnemyRow>[0]['socket']}
        />
        <BattleEnemyRow
          enemy={enemy2}
          socket={fakeSocket as unknown as Parameters<typeof BattleEnemyRow>[0]['socket']}
        />
      </>,
    );

    const [btn1, btn2] = getAllByText('Challenge');

    await act(async () => {
      fireEvent.press(btn1);
    });
    expect(fakeSocket.__emitWithAck).toHaveBeenCalledTimes(1);
    expect(useBattleStore.getState().pendingChallengeTargetId).toBe('enemy-1');

    // enemy-1의 요청이 아직 안 끝난 상태에서 enemy-2 행을 눌러도 disabled라 emit이 늘지 않는다.
    await act(async () => {
      fireEvent.press(btn2);
    });
    expect(fakeSocket.__emitWithAck).toHaveBeenCalledTimes(1);
  });
});
