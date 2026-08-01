import { memo } from 'react';
import { Polygon } from 'react-native-maps';
import busanSigGeoJson from '@/assets/geo/busan_sig.json';
import { DISTRICT_STROKE_COLOR, getDistrictFillColor } from '@/utils/districtColors';
import { withAlpha } from '@/constants/theme';

interface GeoJsonFeature {
  properties: { SIG_CD: string };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
}

// Polygon 등 자치구 경계 shape는 구멍(hole) 없이 외곽 ring만 그린다 — 부산 시군구엔 도넛형 구역이 없음
function outerRingsOf(geometry: GeoJsonFeature['geometry']): number[][][] {
  return geometry.type === 'MultiPolygon'
    ? (geometry.coordinates as number[][][][]).map((polygon) => polygon[0])
    : [(geometry.coordinates as number[][][])[0]];
}

// GeoJSON은 정적 import라 props와 무관하다. 렌더 안에서 변환하면 부산 시군구 전체(약 28,000개)의
// 좌표 객체를 매 렌더마다 새로 만들게 되는데, 이 컴포넌트는 팬/줌뿐 아니라 GPS 갱신(5초)마다도
// 다시 렌더된다. 모듈 로드 시 한 번만 만들어 두고 좌표 배열의 identity도 고정한다
// (react-native-maps의 Polygon은 PureComponent가 아니라 prop identity가 바뀌면 그대로 네이티브까지 내려간다).
const DISTRICT_RINGS = (busanSigGeoJson as { features: GeoJsonFeature[] }).features.flatMap(
  (feature) => {
    const sigCd = feature.properties.SIG_CD;
    const fillColor = withAlpha(getDistrictFillColor(sigCd), 0.1);
    return outerRingsOf(feature.geometry).map((ring, i) => ({
      key: `${sigCd}-${i}`,
      fillColor,
      coordinates: ring.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
    }));
  },
);

const STROKE_COLOR = withAlpha(DISTRICT_STROKE_COLOR, 0.9);

// props가 없어 memo 하나로 리렌더가 완전히 차단된다.
export const DistrictPolygons = memo(function DistrictPolygons() {
  return (
    <>
      {DISTRICT_RINGS.map(({ key, coordinates, fillColor }) => (
        <Polygon
          key={key}
          coordinates={coordinates}
          strokeWidth={2}
          strokeColor={STROKE_COLOR}
          fillColor={fillColor}
        />
      ))}
    </>
  );
});
