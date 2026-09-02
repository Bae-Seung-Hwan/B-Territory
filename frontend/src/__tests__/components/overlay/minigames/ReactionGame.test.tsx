import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { ReactionGame } from '@/components/overlay/minigames/ReactionGame';

// 테스트 환경의 기본 locale은 en이다(expo-localization 목).
describe('ReactionGame', () => {
  it('goSignal이 오기 전에 탭하면 로컬에서만 tooSoon으로 처리하고 서버로 보내지 않는다', async () => {
    const onSubmit = jest.fn();
    const { getByText } = await render(<ReactionGame goSignal={0} onSubmit={onSubmit} />);

    await act(async () => {
      fireEvent.press(getByText('Tap as fast as you can when it turns green'));
    });

    expect(getByText('Too soon! Tap again to restart')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('goSignal이 마운트 시점보다 올라가면 phase가 go로 바뀐다', async () => {
    const onSubmit = jest.fn();
    const { getByText, rerender } = await render(<ReactionGame goSignal={0} onSubmit={onSubmit} />);

    rerender(<ReactionGame goSignal={1} onSubmit={onSubmit} />);

    await waitFor(() => expect(getByText('TAP NOW!')).toBeTruthy());
  });

  it('go 상태에서 탭하면 값 없이 onSubmit을 정확히 한 번 호출한다', async () => {
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
