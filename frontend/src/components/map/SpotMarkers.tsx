import { useRef, useState } from 'react';
import { Marker, type MapMarker, type Region } from 'react-native-maps';
import Svg, { Path, Circle, Text as SvgText } from 'react-native-svg';
import type { Spot } from '@/api/spots';
import { getCategoryMeta } from '@/constants/mapCategories';
import { isCategoryVisible } from '@/utils/mapZoom';

export type MarkerOpenHandler = (marker: MapMarker | null) => void;

interface SpotMarkerProps {
  spot: Spot;
  coordinate: { latitude: number; longitude: number };
  onOpen: MarkerOpenHandler;
}

// 카테고리별 색+이모지 핀을 react-native-svg로 그린다(카카오 버전의 SVG data-URI MarkerImage와
// 동일한 모양). 500개 규모라 초기 레이아웃 이후엔 tracksViewChanges를 꺼서 리렌더 비용을 없앤다.
function SpotMarker({ spot, coordinate, onOpen }: SpotMarkerProps) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const markerRef = useRef<MapMarker>(null);
  const meta = getCategoryMeta(spot.contenttypeid);

  return (
    <Marker
      ref={markerRef}
      coordinate={coordinate}
      title={spot.title}
      description={spot.addr1 ?? undefined}
      tracksViewChanges={tracksViewChanges}
      onLayout={() => setTracksViewChanges(false)}
      // 말풍선이 열린 마커를 부모가 기억해뒀다가, 줌이 바뀌어 이 마커가 화면에서 빠질 때
      // 먼저 닫아준다(BusanMapView 참고). 선택된 채로 제거되면 네이티브 마커 뷰가 지도에
      // 그대로 남아, 축소했는데도 마커 하나만 계속 떠 있는 현상이 생긴다.
      onPress={() => onOpen(markerRef.current)}
    >
      <Svg width={32} height={40} viewBox="0 0 32 40">
        <Path
          d="M16 0C7.163 0 0 7.163 0 16c0 11.5 16 24 16 24s16-12.5 16-24C32 7.163 24.837 0 16 0z"
          fill={meta.color}
        />
        <Circle cx={16} cy={15} r={10.5} fill="#fff" />
        <SvgText x={16} y={20} fontSize={13} textAnchor="middle">
          {meta.emoji}
        </SvgText>
      </Svg>
    </Marker>
  );
}

// 화면 밖 여유분 — 팬을 시작하자마자 마커가 뿅 나타나지 않도록 뷰포트보다 조금 넓게 잡는다.
// 화면 폭/높이의 25%씩(각 변 기준) 더 본다.
const VIEWPORT_PADDING_RATIO = 0.25;

// region의 latitudeDelta/longitudeDelta는 화면에 보이는 "전체" 범위라, 중심에서 각 변까지는 그 절반이다.
function isWithinViewport(lat: number, lng: number, region: Region): boolean {
  const latRadius = region.latitudeDelta * (0.5 + VIEWPORT_PADDING_RATIO);
  const lngRadius = region.longitudeDelta * (0.5 + VIEWPORT_PADDING_RATIO);
  return Math.abs(lat - region.latitude) <= latRadius && Math.abs(lng - region.longitude) <= lngRadius;
}

// 클러스터링을 쓰지 않으므로(BusanMapView 상단 주석 참고) 마커 수를 억제하는 책임이 여기 있다.
// 카테고리/줌 필터에 더해 화면 안에 있는 것만 렌더링해서, 관광지가 몇 개든 실제로 마운트되는
// 마커 수가 화면 단위로 제한되게 한다.
export function buildSpotMarkers(
  spots: Spot[],
  activeCategories: Record<string, boolean>,
  zoom: number,
  region: Region,
  onOpen: MarkerOpenHandler,
): React.ReactElement[] {
  const markers: React.ReactElement[] = [];
  for (const spot of spots) {
    const lat = Number(spot.mapY);
    const lng = Number(spot.mapX);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!isCategoryVisible(spot.contenttypeid, zoom, activeCategories)) continue;
    if (!isWithinViewport(lat, lng, region)) continue;
    markers.push(
      <SpotMarker
        key={spot.id}
        spot={spot}
        coordinate={{ latitude: lat, longitude: lng }}
        onOpen={onOpen}
      />,
    );
  }
  return markers;
}
