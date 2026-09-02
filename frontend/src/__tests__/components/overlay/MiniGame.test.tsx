import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { MiniGame } from '@/components/overlay/MiniGame';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useSocket } from '@/providers/SocketProvider';

jest.mock('@/providers/SocketProvider', () => ({ useSocket: jest.fn() }));

// 테스트 환경의 기본 locale은 en이다(expo-localization 목) — UI 문구 검증은 en.ts 값으로 한다.
const mockedUseSocket = useSocket as jest.Mock;
const initialState = useOverlayStore.getState();

describe('MiniGame', () => {
  const emit = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useOverlayStore.setState(initialState, true);
    useOverlayStore.getState().setDuelId(1);
    useOverlayStore.getState().setShowMiniGame(true);
    mockedUseSocket.mockReturnValue({ emit });
  });

  it('gameType이 아직 없으면(accept~game:start 왕복 구간) 준비 중 화면을 보여준다', async () => {
    const { getByText } = await render(<MiniGame />);
    expect(getByText('Preparing the game...')).toBeTruthy();
  });

  it('gameType이 TAP이면 TapBattle을 연다', async () => {
    useOverlayStore.getState().startGameRound({
      gameType: 'TAP',
      round: 1,
      maxRounds: 2,
      deadlineAt: Date.now() + 45_000,
      tap: { durationSec: 5 },
    });

    const { getByText } = await render(<MiniGame />);

    expect(getByText('Tap as many times as you can in 5 seconds')).toBeTruthy();
    expect(getByText('Round 1/2')).toBeTruthy();
  });

  it('gameType이 QUIZ면 서버가 내려준 문제/선택지를 그대로 보여준다(로컬 채점 없음)', async () => {
    useOverlayStore.getState().startGameRound({
      gameType: 'QUIZ',
      round: 1,
      maxRounds: 2,
      deadlineAt: Date.now() + 45_000,
      quiz: {
        question: { ko: '테스트 문제', en: 'Test question' },
        choices: [
          { ko: '보기1', en: 'Choice1' },
          { ko: '보기2', en: 'Choice2' },
        ],
      },
    });

    const { getByText } = await render(<MiniGame />);

    expect(getByText('Test question')).toBeTruthy();
    expect(getByText('Choice1')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText('Choice1'));
    });

    expect(emit).toHaveBeenCalledWith('game:submit', { duelId: 1, round: 1, value: 0 });
  });

  it('제출하면 대기 화면으로 바뀌고, 다시 제출하지 않는다', async () => {
    useOverlayStore.getState().startGameRound({
      gameType: 'QUIZ',
      round: 1,
      maxRounds: 1,
      deadlineAt: Date.now() + 45_000,
      quiz: {
        question: { ko: 'Q', en: 'Q' },
        choices: [{ ko: 'A', en: 'A' }],
      },
    });

    const { getByText } = await render(<MiniGame />);
    await act(async () => {
      fireEvent.press(getByText('A'));
    });

    expect(getByText('Submitted! Waiting for opponent...')).toBeTruthy();
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('상대가 먼저 제출한 뒤 내가 제출하면 대기 문구가 달라진다', async () => {
    useOverlayStore.getState().startGameRound({
      gameType: 'QUIZ',
      round: 1,
      maxRounds: 1,
      deadlineAt: Date.now() + 45_000,
      quiz: { question: { ko: 'Q', en: 'Q' }, choices: [{ ko: 'A', en: 'A' }] },
    });
    useOverlayStore.getState().setOpponentSubmitted(true);

    const { getByText } = await render(<MiniGame />);
    await act(async () => {
      fireEvent.press(getByText('A'));
    });

    expect(getByText('Your opponent already submitted. Go ahead!')).toBeTruthy();
  });

  it('새 라운드(재경기)가 시작되면 제출 상태가 다시 초기화된다', async () => {
    useOverlayStore.getState().startGameRound({
      gameType: 'QUIZ',
      round: 1,
      maxRounds: 2,
      deadlineAt: Date.now() + 45_000,
      quiz: { question: { ko: 'Q1', en: 'Q1' }, choices: [{ ko: 'A', en: 'A' }] },
    });

    const { getByText, queryByText, rerender } = await render(<MiniGame />);
    await act(async () => {
      fireEvent.press(getByText('A'));
    });
    expect(getByText('Submitted! Waiting for opponent...')).toBeTruthy();

    useOverlayStore.getState().clearGameRound();
    useOverlayStore.getState().startGameRound({
      gameType: 'QUIZ',
      round: 2,
      maxRounds: 2,
      deadlineAt: Date.now() + 45_000,
      quiz: { question: { ko: 'Q2', en: 'Q2' }, choices: [{ ko: 'B', en: 'B' }] },
    });
    rerender(<MiniGame />);

    await waitFor(() => expect(getByText('Round 2/2')).toBeTruthy());
    expect(getByText('Q2')).toBeTruthy();
    expect(queryByText('Submitted! Waiting for opponent...')).toBeNull();
  });
});
