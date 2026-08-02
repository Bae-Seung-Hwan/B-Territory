import { memo } from 'react';
import { Polygon } from 'react-native-maps';
import busanSigGeoJson from '@/assets/geo/busan_sig.json';
import { BUSAN_BOUNDS } from '@/constants/busan';
import {
  DISTRICT_STROKE_COLOR,
  DISTRICT_STROKE_WIDTH,
  OUTSIDE_MASK_ALPHA,
  OUTSIDE_MASK_COLOR,
  getDistrictFillColor,
} from '@/utils/districtColors';
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
      sigCd,
      fillColor,
      coordinates: ring.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
    }));
  },
);

const STROKE_COLOR = withAlpha(DISTRICT_STROKE_COLOR, 0.9);

// 부산 바깥을 덮는 마스크. 지도를 넉넉히 덮는 사각형 하나에서 각 구의 외곽 ring을 구멍으로
// 뚫어, 구 경계 안쪽만 원래 지도 밝기로 남긴다. 구가 서로 맞닿아 있어도 구멍끼리 겹치지
// 않으므로 16개를 그대로 구멍 목록으로 넘기면 된다(섬으로 떨어진 조각도 각자 구멍이 된다).
//
// 여백을 크게 잡는 이유: 지도 중심은 BUSAN_BOUNDS로 clamp되지만 화면에 보이는 범위는 그보다
// 넓다(최소 줌 10에서 화면 폭 ~50km). 사각형은 꼭짓점 4개뿐이라 여유를 줘도 비용이 없다.
const MASK_MARGIN_DEG = 5;
const MASK_OUTER = [
  { latitude: BUSAN_BOUNDS.minLat - MASK_MARGIN_DEG, longitude: BUSAN_BOUNDS.minLng - MASK_MARGIN_DEG },
  { latitude: BUSAN_BOUNDS.minLat - MASK_MARGIN_DEG, longitude: BUSAN_BOUNDS.maxLng + MASK_MARGIN_DEG },
  { latitude: BUSAN_BOUNDS.maxLat + MASK_MARGIN_DEG, longitude: BUSAN_BOUNDS.maxLng + MASK_MARGIN_DEG },
  { latitude: BUSAN_BOUNDS.maxLat + MASK_MARGIN_DEG, longitude: BUSAN_BOUNDS.minLng - MASK_MARGIN_DEG },
];
const MASK_HOLES = DISTRICT_RINGS.map((ring) => ring.coordinates);
const MASK_FILL_COLOR = withAlpha(OUTSIDE_MASK_COLOR, OUTSIDE_MASK_ALPHA);

interface DistrictPolygonsProps {
  /**
   * 구 탭을 받을지 여부. 마커가 보이는 축척에서는 꺼서, 마커를 누르려다 그 아래 폴리곤이
   * 대신 눌리는 일이 없게 한다.
   */
  tappable?: boolean;
  onDistrictPress?: (sigCd: string) => void;
}

// memo가 있어 tappable/onDistrictPress가 그대로면 팬·줌·GPS 갱신에도 리렌더되지 않는다
// (좌표는 모듈 스코프에서 한 번만 만들어 둔다).
export const DistrictPolygons = memo(function DistrictPolygons({
  tappable = false,
  onDistrictPress,
}: DistrictPolygonsProps) {
  return (
    <>
      {/* 구 폴리곤보다 먼저 그려 경계선이 마스크 위에 오게 한다. 테두리(strokeWidth 0)를 그리지
          않는 이유는 구멍 경계에도 같은 선이 그려져 구 경계선과 겹쳐 보이기 때문이다. */}
      <Polygon
        coordinates={MASK_OUTER}
        holes={MASK_HOLES}
        fillColor={MASK_FILL_COLOR}
        strokeWidth={0}
      />
      {DISTRICT_RINGS.map(({ key, sigCd, coordinates, fillColor }) => (
        <Polygon
          key={key}
          coordinates={coordinates}
          strokeWidth={DISTRICT_STROKE_WIDTH}
          strokeColor={STROKE_COLOR}
          fillColor={fillColor}
          tappable={tappable}
          onPress={tappable ? () => onDistrictPress?.(sigCd) : undefined}
        />
      ))}
    </>
  );
});
