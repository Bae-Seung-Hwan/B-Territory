import { SIG_CD_TO_SIGUNGU_CODE, toSigunguCode } from '@/constants/districts';

describe('toSigunguCode', () => {
  it('표에 있는 SIG_CD를 KTO sigungucode로 변환한다', () => {
    expect(toSigunguCode('26350')).toBe('16'); // 해운대구
    expect(toSigunguCode('26110')).toBe('15'); // 중구
  });

  it('표에 없는 코드는 null을 반환한다', () => {
    expect(toSigunguCode('99999')).toBeNull();
    expect(toSigunguCode('')).toBeNull();
  });

  it('KTO 코드(1~16)가 중복 없이 전부 존재한다', () => {
    const codes = Object.values(SIG_CD_TO_SIGUNGU_CODE);
    expect(new Set(codes).size).toBe(16);
    expect(codes.map(Number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
  });
});
