import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from '@/components/ui/Button';

describe('Button', () => {
  it('title을 렌더링하고 탭하면 onPress가 호출된다', async () => {
    const onPress = jest.fn();
    const { getByText } = await render(<Button title="확인" onPress={onPress} />);

    fireEvent.press(getByText('확인'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disabled면 onPress가 호출되지 않는다', async () => {
    const onPress = jest.fn();
    const { getByText } = await render(<Button title="확인" onPress={onPress} disabled />);

    fireEvent.press(getByText('확인'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('loading이면 title 대신 로딩 인디케이터를 보여주고 onPress가 호출되지 않는다', async () => {
    const onPress = jest.fn();
    const { queryByText } = await render(<Button title="확인" onPress={onPress} loading />);

    expect(queryByText('확인')).toBeNull();
  });
});
