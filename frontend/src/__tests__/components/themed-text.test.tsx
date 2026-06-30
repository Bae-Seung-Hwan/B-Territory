import { render } from '@testing-library/react-native';
import React from 'react';

import { ThemedText } from '@/components/themed-text';

jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: jest.fn(() => 'light'),
}));

describe('ThemedText', () => {
  it('텍스트를 렌더링한다', () => {
    const { getByText } = render(<ThemedText>안녕하세요</ThemedText>);
    expect(getByText('안녕하세요')).toBeTruthy();
  });

  it('모든 type prop에서 에러 없이 렌더링된다', () => {
    const types = ['default', 'title', 'small', 'smallBold', 'subtitle', 'link', 'linkPrimary', 'code'] as const;
    types.forEach((type) => {
      const { getByText } = render(<ThemedText type={type}>텍스트</ThemedText>);
      expect(getByText('텍스트')).toBeTruthy();
    });
  });
});
