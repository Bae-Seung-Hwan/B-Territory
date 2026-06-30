import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { Collapsible } from '@/components/ui/collapsible';

jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: jest.fn(() => 'light'),
}));

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    View: require('react-native').View,
    createAnimatedComponent: (component: unknown) => component,
  },
  FadeIn: { duration: () => ({}) },
  useAnimatedStyle: jest.fn(() => ({})),
  useSharedValue: jest.fn((val: unknown) => ({ value: val })),
  withTiming: jest.fn((val: unknown) => val),
}));

jest.mock('expo-symbols', () => ({
  SymbolView: 'SymbolView',
}));

describe('Collapsible', () => {
  it('제목을 렌더링한다', async () => {
    const { getByText } = await render(<Collapsible title="섹션">내용</Collapsible>);
    expect(getByText('섹션')).toBeTruthy();
  });

  it('초기 상태에서 자식 요소가 숨겨져 있다', async () => {
    const { queryByText } = await render(<Collapsible title="섹션">숨겨진 내용</Collapsible>);
    expect(queryByText('숨겨진 내용')).toBeNull();
  });

  it('제목을 누르면 자식 요소가 나타난다', async () => {
    const { getByText, queryByText } = await render(
      <Collapsible title="섹션">표시될 내용</Collapsible>
    );
    fireEvent.press(getByText('섹션'));
    expect(queryByText('표시될 내용')).toBeTruthy();
  });

  it('제목을 두 번 누르면 자식 요소가 다시 숨겨진다', async () => {
    const { getByText, queryByText } = await render(
      <Collapsible title="섹션">토글 내용</Collapsible>
    );
    fireEvent.press(getByText('섹션'));
    fireEvent.press(getByText('섹션'));
    expect(queryByText('토글 내용')).toBeNull();
  });
});
