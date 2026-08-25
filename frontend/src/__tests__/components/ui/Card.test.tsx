import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Card } from '@/components/ui/Card';

describe('Card', () => {
  it('children을 렌더링한다', async () => {
    const { getByText } = await render(
      <Card>
        <Text>내용</Text>
      </Card>,
    );
    expect(getByText('내용')).toBeTruthy();
  });

  it('onPress가 있으면 탭 가능하다', async () => {
    const onPress = jest.fn();
    const { getByText } = await render(
      <Card onPress={onPress}>
        <Text>탭 가능</Text>
      </Card>,
    );

    fireEvent.press(getByText('탭 가능'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
