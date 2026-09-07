import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { ReactionGame } from '@/components/overlay/minigames/ReactionGame';

// 테스트 환경의 기본 locale은 en이다(expo-localization 목).
describe('ReactionGame', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it(
    'goSignal이 오기 전에 탭하면 "너무 빨랐어요"를 잠깐 보여준 뒤 부정출발로 그대로 ' +
      '제출한다 — 서버가 FALSE_START_PRIMARY로 최하점 처리하도록(PR #54 리뷰 지적 7번)',
    async () => {
      jest.useFakeTimers();
      const onSubmit = jest.fn();
      const { getByText } = await render(<ReactionGame goSignal={0} onSubmit={onSubmit} />);

      await act(async () => {
        fireEvent.press(getByText('Tap as fast as you can when it turns green'));
      });

      expect(getByText('Too soon! Submitting as a false start...')).toBeTruthy();
      // 안내를 보여주는 짧은 유예 동안에는 아직 보내지 않는다.
      expect(onSubmit).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(600);
      });

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith();
    },
  );

  it('부정출발 유예 중 추가로 탭해도 한 번만 제출한다', async () => {
    jest.useFakeTimers();
    const onSubmit = jest.fn();
    const { getByText } = await render(<ReactionGame goSignal={0} onSubmit={onSubmit} />);

    await act(async () => {
      fireEvent.press(getByText('Tap as fast as you can when it turns green'));
    });
    await act(async () => {
      fireEvent.press(getByText('Too soon! Submitting as a false start...'));
      fireEvent.press(getByText('Too soon! Submitting as a false start...'));
    });

    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('goSignal이 마운트 시점보다 올라가면 phase가 go로 바뀐다', async () => {
    const onSubmit = jest.fn();
    const { getByText, rerender } = await render(<ReactionGame goSignal={0} onSubmit={onSubmit} />);

    rerender(<ReactionGame goSignal={1} onSubmit={onSubmit} />);

    await waitFor(() => expect(getByText('TAP NOW!')).toBeTruthy());
  });

  it('go 상태에서 탭하면 값 없이 onSubmit을 정확히 한 번(즉시) 호출한다', async () => {
    const onSubmit = jest.fn();
    const { getByText, rerender } = await render(<ReactionGame goSignal={0} onSubmit={onSubmit} />);
    rerender(<ReactionGame goSignal={1} onSubmit={onSubmit} />);
    await waitFor(() => expect(getByText('TAP NOW!')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByText('TAP NOW!'));
      fireEvent.press(getByText('TAP NOW!'));
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith();
  });
});
