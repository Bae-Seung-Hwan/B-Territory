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

  it(
    'MINIGAME_INVALID_SCORE로 mySubmitted가 되돌아오면 같은 라운드에 다시 제출할 수 있다 ' +
      '(PR #54 3차 리뷰 지적 1번 — 되돌림을 이 코드 하나로 좁힌 뒤에도 재제출 경로 자체는 ' +
      '살아 있어야 한다)',
    async () => {
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

      await act(async () => {
        fireEvent.press(getByText('Choice1'));
      });
      expect(emit).toHaveBeenCalledTimes(1);
      // 제출 뒤에는 게임이 사라지고 대기 화면이 된다.
      expect(getByText('Submitted! Waiting for opponent...')).toBeTruthy();

      // SocketProvider의 exception 핸들러가 하는 일과 동일하다.
      await act(async () => {
        useOverlayStore.getState().setMySubmitted(false);
      });

      await act(async () => {
        fireEvent.press(getByText('Choice2'));
      });
      expect(emit).toHaveBeenNthCalledWith(2, 'game:submit', { duelId: 1, round: 1, value: 1 });
    },
  );

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

  it(
    '상대가 먼저 제출했는데 나는 아직이면, 아직 제출 전인 지금 재촉 문구가 뜬다 ' +
      '(PR #54 리뷰 지적 8번 — 예전엔 이 문구가 정반대로 "내가 이미 제출한 뒤"에만 떴다)',
    async () => {
      useOverlayStore.getState().startGameRound({
        gameType: 'QUIZ',
        round: 1,
        maxRounds: 1,
        deadlineAt: Date.now() + 45_000,
        quiz: { question: { ko: 'Q', en: 'Q' }, choices: [{ ko: 'A', en: 'A' }] },
      });
      useOverlayStore.getState().setOpponentSubmitted(true);

      const { getByText } = await render(<MiniGame />);

      // 아직 내가 제출하기 전(퀴즈 선택지가 그대로 보이는 시점)에 재촉 문구가 함께 보여야
      // 의미가 있다 — 이미 낸 뒤엔 재촉할 이유가 없다.
      expect(getByText('Your opponent already submitted. Go ahead!')).toBeTruthy();
      expect(getByText('Q')).toBeTruthy();

      await act(async () => {
        fireEvent.press(getByText('A'));
      });

      // 제출한 뒤엔 상대가 먼저 냈든 아니든 같은 대기 문구로 통일된다.
      expect(getByText('Submitted! Waiting for opponent...')).toBeTruthy();
    },
  );

  it(
    '남은 시간을 초 단위로 보여주고 시간이 흐르면 줄어든다 (PR #54 리뷰 지적 6번 — ' +
      '예전엔 gameDeadlineAt을 저장만 하고 아무도 쓰지 않아 45초 마감이 화면에 전혀 없었다)',
    async () => {
      jest.useFakeTimers();
      const now = Date.now();
      useOverlayStore.getState().startGameRound({
        gameType: 'TAP',
        round: 1,
        maxRounds: 1,
        deadlineAt: now + 10_000,
        tap: { durationSec: 5 },
      });

      const { getByText } = await render(<MiniGame />);
      await waitFor(() => expect(getByText('10s left')).toBeTruthy());

      await act(async () => {
        jest.advanceTimersByTime(3_000);
      });

      expect(getByText('7s left')).toBeTruthy();
      jest.useRealTimers();
    },
  );

  it('내가 먼저 제출하고 상대가 아직이면(재촉할 대상이 나) 재촉 문구가 뜨지 않는다', async () => {
    useOverlayStore.getState().startGameRound({
      gameType: 'QUIZ',
      round: 1,
      maxRounds: 1,
      deadlineAt: Date.now() + 45_000,
      quiz: { question: { ko: 'Q', en: 'Q' }, choices: [{ ko: 'A', en: 'A' }] },
    });

    const { getByText, queryByText } = await render(<MiniGame />);
    await act(async () => {
      fireEvent.press(getByText('A'));
    });

    expect(getByText('Submitted! Waiting for opponent...')).toBeTruthy();
    expect(queryByText('Your opponent already submitted. Go ahead!')).toBeNull();
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

  it(
    '재경기로 라운드가 바뀐 뒤에도 새 라운드 번호로 game:submit이 실제로 나간다 ' +
      '(PR #54 2차 리뷰 지적 1번 관련 — 기존 "제출 상태가 다시 초기화된다" 테스트는 UI 문구만 ' +
      '확인하고 실제 제출 emit은 검증하지 않았다. 이 시나리오에서 리뷰가 지적한 재사용 ' +
      '인스턴스 문제는 재현하지 못했지만, key={gameRound}는 서버 이벤트 배칭 시점에 따라 ' +
      'React가 컴포넌트를 재사용할 가능성 자체를 구조적으로 없애는 표준적인 방어라 그대로 둔다)',
    async () => {
      useOverlayStore.getState().startGameRound({
        gameType: 'QUIZ',
        round: 1,
        maxRounds: 2,
        deadlineAt: Date.now() + 45_000,
        quiz: { question: { ko: 'Q1', en: 'Q1' }, choices: [{ ko: 'A', en: 'A' }] },
      });

      const { getByText, rerender } = await render(<MiniGame />);
      await act(async () => {
        fireEvent.press(getByText('A'));
      });
      expect(emit).toHaveBeenCalledWith('game:submit', { duelId: 1, round: 1, value: 0 });

      // 서버의 game:round:result(clearGameRound)와 곧이은 game:start(startGameRound)가 같은
      // 렌더 배치로 묶이는 경우를 흉내낸다 — 한 act() 안에서 두 store 업데이트를 연달아
      // 호출하면, 중간에 gameType이 null인 별도 커밋 없이 라운드 2 상태로 곧장 렌더된다.
      await act(async () => {
        useOverlayStore.getState().clearGameRound();
        useOverlayStore.getState().startGameRound({
          gameType: 'QUIZ',
          round: 2,
          maxRounds: 2,
          deadlineAt: Date.now() + 45_000,
          quiz: { question: { ko: 'Q2', en: 'Q2' }, choices: [{ ko: 'B', en: 'B' }] },
        });
      });
      rerender(<MiniGame />);

      await waitFor(() => expect(getByText('Q2')).toBeTruthy());
      await act(async () => {
        fireEvent.press(getByText('B'));
      });

      expect(emit).toHaveBeenCalledWith('game:submit', { duelId: 1, round: 2, value: 0 });
    },
  );

  it(
    'game:submit이 MINIGAME_ 실패로 거절되면 마감 전 재제출이 가능하도록 제출 상태를 ' +
      '되돌린다 (PR #54 2차 리뷰 지적 2번 — 예전엔 MINIGAME_ 코드가 DUEL_ 접두사 필터에 ' +
      '걸려 조용히 버려지고 사용자는 45초 뒤 기권패로만 결과를 알았다)',
    async () => {
      useOverlayStore.getState().startGameRound({
        gameType: 'QUIZ',
        round: 1,
        maxRounds: 1,
        deadlineAt: Date.now() + 45_000,
        quiz: { question: { ko: 'Q', en: 'Q' }, choices: [{ ko: 'A', en: 'A' }] },
      });

      const { getByText } = await render(<MiniGame />);
      await act(async () => {
        fireEvent.press(getByText('A'));
      });
      expect(getByText('Submitted! Waiting for opponent...')).toBeTruthy();

      // SocketProvider의 exception 핸들러가 MINIGAME_INVALID_SCORE 등을 받으면 이렇게
      // mySubmitted를 되돌린다 — 여기서는 그 결과만 검증한다(SocketProvider 자체 동작은
      // SocketProvider.test.tsx가 검증).
      await act(async () => {
        useOverlayStore.getState().setMySubmitted(false);
      });

      expect(getByText('A')).toBeTruthy();
    },
  );
});
