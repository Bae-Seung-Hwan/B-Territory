import React from 'react';
import { render } from '@testing-library/react-native';
import { Badge } from '@/components/ui/Badge';

describe('Badge', () => {
  it('label을 렌더링한다', async () => {
    const { getByText } = await render(<Badge label="1위" />);
    expect(getByText('1위')).toBeTruthy();
  });
});
