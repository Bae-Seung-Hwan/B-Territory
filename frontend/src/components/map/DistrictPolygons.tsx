import { Polygon } from 'react-native-maps';
import busanSigGeoJson from '@/assets/geo/busan_sig.json';
import { getDistrictFillColor } from '@/utils/districtColors';

interface GeoJsonFeature {
  properties: { SIG_CD: string };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
}

interface DistrictPolygonsProps {
  occupiedDistricts?: Record<string, string>;
  onDistrictPress?: (sigCd: string) => void;
}

// #rrggbb + 0-1 alpha → rgba(), react-native-maps의 fillColor/strokeColor는 rgba() 문자열을
// 크로스플랫폼으로 지원한다(8자리 hex는 플랫폼별 지원이 엇갈림)
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Polygon 등 자치구 경계 shape는 구멍(hole) 없이 외곽 ring만 그린다 — 부산 시군구엔 도넛형 구역이 없음
function outerRingsOf(geometry: GeoJsonFeature['geometry']): number[][][] {
  return geometry.type === 'MultiPolygon'
    ? (geometry.coordinates as number[][][][]).map((polygon) => polygon[0])
    : [(geometry.coordinates as number[][][])[0]];
}

export function DistrictPolygons({ occupiedDistricts, onDistrictPress }: DistrictPolygonsProps) {
  const features = (busanSigGeoJson as { features: GeoJsonFeature[] }).features;

  return (
    <>
      {features.flatMap((feature) => {
        const sigCd = feature.properties.SIG_CD;
        const fillColor = getDistrictFillColor(sigCd, occupiedDistricts);

        return outerRingsOf(feature.geometry).map((ring, i) => (
          <Polygon
            key={`${sigCd}-${i}`}
            coordinates={ring.map(([lng, lat]) => ({ latitude: lat, longitude: lng }))}
            strokeWidth={2}
            strokeColor={withAlpha('#4FC3F7', 0.9)}
            fillColor={withAlpha(fillColor, 0.1)}
            tappable={!!onDistrictPress}
            onPress={() => onDistrictPress?.(sigCd)}
          />
        ));
      })}
    </>
  );
}
