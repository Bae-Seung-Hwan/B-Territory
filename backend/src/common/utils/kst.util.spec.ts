import { secondsUntilKstMidnight, startOfKstWeek } from './kst.util';

describe('secondsUntilKstMidnight', () => {
  it('KST 23:59:30에는 30초를 반환한다', () => {
    // 2026-07-16 23:59:30 KST = 2026-07-16 14:59:30 UTC
    expect(secondsUntilKstMidnight(new Date('2026-07-16T14:59:30Z'))).toBe(30);
  });

  it('KST 자정 정각에는 다음 자정까지 하루 전체(86400초)를 반환한다', () => {
    // 2026-07-17 00:00:00 KST = 2026-07-16 15:00:00 UTC
    expect(secondsUntilKstMidnight(new Date('2026-07-16T15:00:00Z'))).toBe(
      86400,
    );
  });

  it('KST 정오에는 12시간(43200초)을 반환한다', () => {
    // 2026-07-16 12:00:00 KST = 2026-07-16 03:00:00 UTC
    expect(secondsUntilKstMidnight(new Date('2026-07-16T03:00:00Z'))).toBe(
      43200,
    );
  });

  it('자정 직전 밀리초 단위에서도 1 이상을 반환한다 (Redis EX 0은 에러)', () => {
    expect(
      secondsUntilKstMidnight(new Date('2026-07-16T14:59:59.999Z')),
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('startOfKstWeek', () => {
  // 2026-07-13은 월요일. 그 주 시작 = 2026-07-13 00:00 KST = 2026-07-12T15:00:00Z
  const MONDAY_WEEK_START = '2026-07-12T15:00:00.000Z';

  it('주중(수요일 정오)에는 그 주 월요일 00:00 KST를 반환한다', () => {
    // 2026-07-15 12:00 KST = 2026-07-15T03:00:00Z
    expect(startOfKstWeek(new Date('2026-07-15T03:00:00Z')).toISOString()).toBe(
      MONDAY_WEEK_START,
    );
  });

  it('월요일 00:00 KST 정각에는 그 시각 자신을 반환한다', () => {
    expect(startOfKstWeek(new Date(MONDAY_WEEK_START)).toISOString()).toBe(
      MONDAY_WEEK_START,
    );
  });

  it('일요일 밤(주의 끝)에는 그 주 월요일을 반환한다 (Sun=주 마지막)', () => {
    // 2026-07-19(일) 23:00 KST = 2026-07-19T14:00:00Z → 같은 주(7/13 월요일 시작)
    expect(startOfKstWeek(new Date('2026-07-19T14:00:00Z')).toISOString()).toBe(
      MONDAY_WEEK_START,
    );
  });

  it('다음 월요일 00:00 KST에는 새 주로 넘어간다', () => {
    // 2026-07-20(월) 00:00 KST = 2026-07-19T15:00:00Z → 새 주 시작 자신
    expect(startOfKstWeek(new Date('2026-07-19T15:00:00Z')).toISOString()).toBe(
      '2026-07-19T15:00:00.000Z',
    );
  });
});
