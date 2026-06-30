import { Colors, Spacing } from '@/constants/theme';

describe('Colors', () => {
  it('light와 dark 테마가 동일한 키를 가진다', () => {
    expect(Object.keys(Colors.light)).toEqual(Object.keys(Colors.dark));
  });

  it('light 테마 색상이 정의되어 있다', () => {
    expect(Colors.light.text).toBe('#000000');
    expect(Colors.light.background).toBe('#ffffff');
  });

  it('dark 테마 색상이 정의되어 있다', () => {
    expect(Colors.dark.text).toBe('#ffffff');
    expect(Colors.dark.background).toBe('#000000');
  });
});

describe('Spacing', () => {
  it('값이 오름차순으로 정의되어 있다', () => {
    const values = Object.values(Spacing);
    const sorted = [...values].sort((a, b) => a - b);
    expect(values).toEqual(sorted);
  });
});
