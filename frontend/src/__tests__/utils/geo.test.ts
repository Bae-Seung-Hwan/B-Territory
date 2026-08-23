import { haversineDistanceMeters } from '@/utils/geo';

// 부산 실제 좌표 (해운대해수욕장 / 광안리해수욕장)
const HAEUNDAE = { lat: 35.1587, lng: 129.1604 };
const GWANGALLI = { lat: 35.1532, lng: 129.1187 };

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
