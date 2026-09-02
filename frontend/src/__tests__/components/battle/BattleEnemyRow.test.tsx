import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { BattleEnemyRow } from '@/components/battle/BattleEnemyRow';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useBattleStore } from '@/store/useBattleStore';

// 테스트 환경의 기본 locale은 en이다(expo-localization 목) — UI 문구 검증은 en.ts 값으로 한다.
const enemy = { userId: 'enemy-1', nickname: 'tlgus', team: 'JP' };
const initialOverlayState = useOverlayStore.getState();
const initialBattleState = useBattleStore.getState();

describe('BattleEnemyRow', () => {
  const emit = jest.fn();
  const handlers: Record<string, (payload: unknown) => void> = {};
  const on = jest.fn((event: string, handler: (payload: unknown) => void) => {
    handlers[event] = handler;
  });
  const off = jest.fn();
  const socket = { emit, on, off } as unknown as Parameters<typeof BattleEnemyRow>[0]['socket'];

  beforeEach(() => {
    jest.clearAllMocks();
    useOverlayStore.setState(initialOverlayState, true);
    useBattleStore.setState(initialBattleState, true);
  });

  it('duel:request가 서버에서 throw로 끝나(ack 미호출) exception 이벤트만 오는 경우, 버튼이 스피너에 갇히지 않고 재시도 가능해진다', async () => {
    const { getByText, queryByText } = await render(<BattleEnemyRow enemy={enemy} socket={socket} />);

    await act(async () => {
      fireEvent.press(getByText('Challenge'));
    });

    // pending 중에는 ActivityIndicator만 보이고 "Challenge" 텍스트는 사라진다.
    expect(emit).toHaveBeenCalledWith('duel:request', { targetUserId: 'enemy-1' }, expect.any(Function));
    expect(queryByText('Challenge')).toBeNull();

    // 서버가 ack 없이 exception만 보낸 경우(예: DUEL_OUT_OF_RANGE) — ack 콜백은 호출되지 않는다.
    await act(async () => {
      handlers['exception']({ code: 'DUEL_OUT_OF_RANGE' });
    });

    await waitFor(() => expect(getByText('Challenge')).toBeTruthy());
  });

  it('DUEL_ 접두사가 아닌 무관한 exception은 pending을 건드리지 않는다', async () => {
    const { getByText, queryByText } = await render(<BattleEnemyRow enemy={enemy} socket={socket} />);

    await act(async () => {
      fireEvent.press(getByText('Challenge'));
    });
    expect(queryByText('Challenge')).toBeNull();

    await act(async () => {
      handlers['exception']({ code: 'LOCATION_INVALID' });
    });

    expect(queryByText('Challenge')).toBeNull();
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
  });
});
