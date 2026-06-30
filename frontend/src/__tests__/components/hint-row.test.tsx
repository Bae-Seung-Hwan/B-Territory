import { render } from '@testing-library/react-native';
import React from 'react';

import { HintRow } from '@/components/hint-row';

jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: jest.fn(() => 'light'),
}));

describe('HintRow', () => {
  it('기본 props로 렌더링된다', async () => {
    const { getByText } = await render(<HintRow />);
    expect(getByText('Try editing')).toBeTruthy();
    expect(getByText('app/index.tsx')).toBeTruthy();
  });

  it('커스텀 title과 hint를 렌더링한다', async () => {
    const { getByText } = await render(<HintRow title="파일 수정" hint="src/app/index.tsx" />);
    expect(getByText('파일 수정')).toBeTruthy();
    expect(getByText('src/app/index.tsx')).toBeTruthy();
  });
});
