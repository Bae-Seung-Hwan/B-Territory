import { haversineDistanceMeters, nearestByCoords } from '@/utils/geo';

// 부산 실제 좌표 (해운대해수욕장 / 광안리해수욕장)
const HAEUNDAE = { lat: 35.1587, lng: 129.1604 };
const GWANGALLI = { lat: 35.1532, lng: 129.1187 };

interface Spot {
  title: string;
  lat: number;
  lng: number;
}

const toCoords = (s: Spot) => ({ lat: s.lat, lng: s.lng });

describe('haversineDistanceMeters', () => {
  it('returns ~0 for identical points', () => {
    expect(haversineDistanceMeters(HAEUNDAE, HAEUNDAE)).toBeCloseTo(0, 5);
  });

  it('matches the real distance between two Busan beaches (~3.9km)', () => {
    const d = haversineDistanceMeters(HAEUNDAE, GWANGALLI);
    expect(d).toBeGreaterThan(3500);
    expect(d).toBeLessThan(4300);
  });
});

describe('nearestByCoords', () => {
  const spots: Spot[] = [
    { title: '해운대', ...HAEUNDAE },
    { title: '광안리', ...GWANGALLI },
  ];

  it('picks the closest item', () => {
    expect(nearestByCoords(HAEUNDAE, spots, toCoords)?.title).toBe('해운대');
    expect(nearestByCoords(GWANGALLI, spots, toCoords)?.title).toBe('광안리');
  });

  it('returns null when everything is beyond maxDistanceM', () => {
    // 서울에서 공유한 좌표가 부산 관광지로 잘못 매칭되던 문제 방지
    const seoul = { lat: 37.5665, lng: 126.978 };
    expect(nearestByCoords(seoul, spots, toCoords, 500)).toBeNull();
    // 상한이 없으면 (기존 동작) 아무거나 가장 가까운 걸 고른다
    expect(nearestByCoords(seoul, spots, toCoords)).not.toBeNull();
  });

  it('respects maxDistanceM at close range', () => {
    // 해운대에서 광안리(~3.9km)는 500m 상한 밖이라 매칭되지 않아야 한다
    const nearHaeundae = { lat: 35.159, lng: 129.1606 };
    expect(nearestByCoords(nearHaeundae, spots, toCoords, 500)?.title).toBe('해운대');
    expect(nearestByCoords(nearHaeundae, [spots[1]], toCoords, 500)).toBeNull();
  });

  it('skips items whose coordinates are not finite', () => {
    // Spot.mapX/mapY는 string | number | null이라 Number() 변환 결과가 두 갈래로 갈린다.
    // NaN(변환 불가)은 비교 자체가 항상 false라 조용히 건너뛰어야 하고,
    const withNaN: Spot[] = [
      { title: '좌표없음', lat: NaN, lng: NaN },
      { title: '해운대', ...HAEUNDAE },
    ];
    expect(nearestByCoords(HAEUNDAE, withNaN, toCoords)?.title).toBe('해운대');

    // null → Number(null) === 0 이라 (0,0)이라는 "유효하지만 엉뚱한" 좌표가 된다.
    // 이건 finite라 통과하므로 반경 상한이 막아준다.
    const withZero: Spot[] = [
      { title: '좌표없음', lat: 0, lng: 0 },
      { title: '해운대', ...HAEUNDAE },
    ];
    expect(nearestByCoords(HAEUNDAE, withZero, toCoords, 500)?.title).toBe('해운대');
  });
});
