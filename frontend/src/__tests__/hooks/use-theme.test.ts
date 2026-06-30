import { renderHook } from '@testing-library/react-native';

import { Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: jest.fn(),
}));

import { useColorScheme } from '@/hooks/use-color-scheme';

describe('useTheme', () => {
  it('light 모드일 때 light 색상을 반환한다', () => {
    (useColorScheme as jest.Mock).mockReturnValue('light');
    const { result } = renderHook(() => useTheme());
    expect(result.current).toEqual(Colors.light);
  });

  it('dark 모드일 때 dark 색상을 반환한다', () => {
    (useColorScheme as jest.Mock).mockReturnValue('dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current).toEqual(Colors.dark);
  });

  it('unspecified일 때 light 색상을 반환한다', () => {
    (useColorScheme as jest.Mock).mockReturnValue('unspecified');
    const { result } = renderHook(() => useTheme());
    expect(result.current).toEqual(Colors.light);
  });
});
