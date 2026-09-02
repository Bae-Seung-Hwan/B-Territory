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

describe('BattleEnemyRow', () => {
  const emit = jest.fn();
  const socket = { emit } as unknown as Parameters<typeof BattleEnemyRow>[0]['socket'];

  beforeEach(() => {
    jest.clearAllMocks();
    useOverlayStore.setState(initialOverlayState, true);
    useBattleStore.setState(initialBattleState, true);
  });

  it('duel:request가 서버에서 throw로 끝나(ack 미호출) 실패해도, pendingChallengeTargetId가 비워지면 재시도 가능해진다', async () => {
    const { getByText, queryByText } = await render(<BattleEnemyRow enemy={enemy} socket={socket} />);

    await act(async () => {
      fireEvent.press(getByText('Challenge'));
    });

    // pending 중에는 ActivityIndicator만 보이고 "Challenge" 텍스트는 사라진다.
    expect(emit).toHaveBeenCalledWith('duel:request', { targetUserId: 'enemy-1' }, expect.any(Function));
    expect(queryByText('Challenge')).toBeNull();
    expect(useBattleStore.getState().pendingChallengeTargetId).toBe('enemy-1');

    // 서버가 ack 없이 exception만 보낸 경우(예: DUEL_OUT_OF_RANGE) ack 콜백은 호출되지 않는다 —
    // 이 실패를 감지해 pendingChallengeTargetId를 비우는 건 SocketProvider의 전역 handleException
    // 몫이라 여기서는 그 결과(값이 비워짐)만 재현한다.
    await act(async () => {
      useBattleStore.getState().setPendingChallengeTargetId(null);
    });

    expect(getByText('Challenge')).toBeTruthy();
  });

  it('ack이 성공으로 오면 정상적으로 duel pending 오버레이를 연다', async () => {
    const { getByText } = await render(<BattleEnemyRow enemy={enemy} socket={socket} />);

    await act(async () => {
      fireEvent.press(getByText('Challenge'));
    });

    const ackCallback = emit.mock.calls[0][2] as (ack: { status: string; duelId: number }) => void;
    await act(async () => {
      ackCallback({ status: 'ok', duelId: 42 });
    });

    expect(useOverlayStore.getState().duelId).toBe(42);
    expect(useOverlayStore.getState().showDuelPending).toBe(true);
    expect(useBattleStore.getState().pendingChallengeTargetId).toBeNull();
  });

  it('한 행이 결투 신청 중이면 다른 행의 Challenge를 눌러도 요청이 나가지 않는다', async () => {
    const { getAllByText } = await render(
      <>
        <BattleEnemyRow enemy={enemy} socket={socket} />
        <BattleEnemyRow enemy={enemy2} socket={socket} />
      </>,
    );

    const [btn1, btn2] = getAllByText('Challenge');

    await act(async () => {
      fireEvent.press(btn1);
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(useBattleStore.getState().pendingChallengeTargetId).toBe('enemy-1');

    // enemy-1의 요청이 아직 안 끝난 상태에서 enemy-2 행을 눌러도 disabled라 emit이 늘지 않는다.
    await act(async () => {
      fireEvent.press(btn2);
    });
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
