import { RINGS_BY_SIGUNGU_CODE } from '@/components/map/DistrictPolygons';
import { SIG_CD_TO_SIGUNGU_CODE } from '@/constants/districts';

// PR #47이 고친 버그(코드 체계 불일치로 "16" === "26350" 비교가 항상 false가 되어 수도 강조가
// 한 번도 렌더되지 않던 문제)의 회귀 테스트. 타입체크로는 안 잡힌다 — 양쪽 다 string이라서다.
describe('RINGS_BY_SIGUNGU_CODE', () => {
  it('부산 16개 구 모두 KTO sigungucode로 ring이 1개 이상 잡힌다', () => {
    for (const [sigCd, sigunguCode] of Object.entries(SIG_CD_TO_SIGUNGU_CODE)) {
      const rings = RINGS_BY_SIGUNGU_CODE.get(sigunguCode);
      expect(rings?.length ?? 0).toBeGreaterThan(0);
      // 이번 버그의 정확한 재현 형태: 매핑이 어긋나면 매칭되는 ring이 하나도 없다.
      expect(rings?.every((ring) => ring.sigCd === sigCd)).toBe(true);
    }
  });

  it('섬·매립지로 나뉜 구(사하구·강서구)는 ring을 여러 개 갖는다', () => {
    const sahaRings = RINGS_BY_SIGUNGU_CODE.get('10'); // 사하구
    const gangseoRings = RINGS_BY_SIGUNGU_CODE.get('1'); // 강서구
    expect(sahaRings?.length ?? 0).toBeGreaterThan(1);
    expect(gangseoRings?.length ?? 0).toBeGreaterThan(1);
  });

  it('표에 없는 코드로는 조회되지 않는다', () => {
    expect(RINGS_BY_SIGUNGU_CODE.get('존재하지-않음')).toBeUndefined();
  });
});
