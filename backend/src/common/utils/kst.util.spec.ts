import {
  secondsUntilKstMidnight,
  kstDateString,
  kstYyyymmdd,
  seasonIndexOf,
  seasonRange,
} from './kst.util';

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

describe('kstDateString', () => {
  it('UTC 자정 직후를 KST 날짜(+9h)로 넘긴다', () => {
    // 2026-08-03T15:30Z → KST 2026-08-04T00:30 → 8/4
    expect(kstDateString(new Date('2026-08-03T15:30:00Z'))).toBe('2026-08-04');
  });

  it('KST 자정 직전은 전날로 판정한다', () => {
    // 2026-08-03T14:30Z → KST 2026-08-03T23:30 → 8/3
    expect(kstDateString(new Date('2026-08-03T14:30:00Z'))).toBe('2026-08-03');
  });
});

describe('kstYyyymmdd', () => {
  it('KST 날짜를 YYYYMMDD로 압축한다', () => {
    expect(kstYyyymmdd(new Date('2026-08-03T15:30:00Z'))).toBe('20260804');
  });

  it('offsetDays로 과거/미래 날짜를 계산한다', () => {
    const base = new Date('2026-08-03T15:30:00Z'); // KST 8/4
    expect(kstYyyymmdd(base, -1)).toBe('20260803');
    expect(kstYyyymmdd(base, 30)).toBe('20260903');
  });
});

describe('seasonIndexOf', () => {
  it('시즌 시작(2026-09-01 KST) 직전은 pre-season(0)', () => {
    // 2026-08-31 23:59 KST = 2026-08-31T14:59:00Z
    expect(seasonIndexOf(new Date('2026-08-31T14:59:00Z'))).toBe(0);
  });

  it('오늘(2026-08-01)은 pre-season(0)', () => {
    expect(seasonIndexOf(new Date('2026-08-01T00:00:00Z'))).toBe(0);
  });

  it('2026-09-01 00:00 KST는 시즌 1', () => {
    // = 2026-08-31T15:00:00Z
    expect(seasonIndexOf(new Date('2026-08-31T15:00:00Z'))).toBe(1);
  });

  it('시즌 1 마지막 달(2026-11) 은 시즌 1', () => {
    expect(seasonIndexOf(new Date('2026-11-15T00:00:00Z'))).toBe(1);
  });

  it('2026-12-01 KST부터 시즌 2 (연말 넘김)', () => {
    // 2026-12-01 00:00 KST = 2026-11-30T15:00:00Z
    expect(seasonIndexOf(new Date('2026-11-30T15:00:00Z'))).toBe(2);
    expect(seasonIndexOf(new Date('2027-01-15T00:00:00Z'))).toBe(2);
  });

  it('2027-03-01 KST부터 시즌 3', () => {
    expect(seasonIndexOf(new Date('2027-02-28T15:00:00Z'))).toBe(3);
  });
});

describe('seasonRange', () => {
  it('시즌 1 = [2026-09-01, 2026-12-01) KST', () => {
    const { start, end } = seasonRange(1);
    expect(start.toISOString()).toBe('2026-08-31T15:00:00.000Z'); // 2026-09-01 00:00 KST
    expect(end.toISOString()).toBe('2026-11-30T15:00:00.000Z'); // 2026-12-01 00:00 KST
  });

  it('시즌 2 = [2026-12-01, 2027-03-01) KST', () => {
    const { start, end } = seasonRange(2);
    expect(start.toISOString()).toBe('2026-11-30T15:00:00.000Z');
    expect(end.toISOString()).toBe('2027-02-28T15:00:00.000Z'); // 2027-03-01 00:00 KST
  });

  it('연속 시즌의 end와 다음 start가 맞물린다', () => {
    expect(seasonRange(1).end.getTime()).toBe(seasonRange(2).start.getTime());
    expect(seasonRange(2).end.getTime()).toBe(seasonRange(3).start.getTime());
  });
});
