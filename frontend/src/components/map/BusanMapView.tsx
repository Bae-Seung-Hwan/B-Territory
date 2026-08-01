import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle, useWindowDimensions } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { Spot } from '@/api/spots';
import { useSpotClaim } from '@/hooks/use-spot-claim';
import {
  BUSAN_BOUNDS,
  BUSAN_CENTER,
  BUSAN_INITIAL_DELTA,
  BUSAN_MAX_ZOOM_LEVEL,
  BUSAN_MIN_ZOOM_LEVEL,
} from '@/constants/busan';
import { zoomFromLongitudeDelta } from '@/utils/geo';
import { CATEGORY_META, DEFAULT_CATEGORY_KEY } from '@/constants/mapCategories';
import { CategoryFilterPanel } from './CategoryFilterPanel';
import { CurrentLocationMarker } from './CurrentLocationMarker';
import { DistrictPolygons } from './DistrictPolygons';
import { SpotDetailSheet } from './SpotDetailSheet';
import { buildSpotMarkers, toSpotPoints } from './SpotMarkers';

// 한때 react-native-map-clustering으로 마커를 군집화했으나 제거했다. 그 라이브러리는 개별 마커를
// propsChildren[index](배열 인덱스)로 참조하는데, 줌에 따라 마커 배열의 길이가 바뀌는 이 화면에서는
// 이전에 계산해둔 인덱스가 어긋난다. 게다가 마커 목록을 children 변경 effect와 region 변경 콜백
// 두 경로에서 각각 갱신해 낡은 결과가 최신 결과를 덮어써서, 확대/축소를 반복할수록 사라져야 할
// 마커가 지도에 누적됐다(클러스터링을 끄면 재현되지 않는 것으로 원인 확인).
// 대신 화면(뷰포트) 안에 있는 마커만 렌더링해서 마커 수를 화면 단위로 제한한다.

const INITIAL_REGION: Region = {
  latitude: BUSAN_CENTER.lat,
  longitude: BUSAN_CENTER.lng,
  ...BUSAN_INITIAL_DELTA,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// 카카오 버전의 dragend clamp와 동일한 목적으로 중심 좌표만 BUSAN_BOUNDS로 제한한다.
// 확대/축소 한계는 minZoomLevel/maxZoomLevel prop이 제스처 단계에서 네이티브로 막아주므로
// 여기서 delta를 따로 clamp할 필요가 없다.
function clampRegionCenter(region: Region): Region | null {
  const latitude = clamp(region.latitude, BUSAN_BOUNDS.minLat, BUSAN_BOUNDS.maxLat);
  const longitude = clamp(region.longitude, BUSAN_BOUNDS.minLng, BUSAN_BOUNDS.maxLng);

  if (latitude === region.latitude && longitude === region.longitude) return null;
  return { ...region, latitude, longitude };
}

// "전체 끄기"를 하려면 CATEGORY_META에 없는 미분류 스팟이 묶이는 DEFAULT_CATEGORY_KEY까지
// 명시적으로 꺼야 한다.
const ALL_CATEGORY_KEYS = [...Object.keys(CATEGORY_META), DEFAULT_CATEGORY_KEY];

interface Coords {
  latitude: number;
  longitude: number;
}

export interface BusanMapViewHandle {
  panTo: (coords: Coords) => void;
}

interface BusanMapViewProps {
  style?: StyleProp<ViewStyle>;
  spots?: Spot[];
  coords?: Coords | null;
  onReady?: () => void;
}

export const BusanMapView = forwardRef<BusanMapViewHandle, BusanMapViewProps>(function BusanMapView(
  { style, spots = [], coords = null, onReady },
  ref,
) {
  const mapRef = useRef<MapView>(null);
  // 뷰포트 필터링용 — 화면에 보이는 영역이 바뀌면 렌더링할 마커 집합도 다시 계산해야 하므로
  // ref가 아니라 state로 들고 있어야 한다(팬만 해도 갱신되어야 하니 zoom과는 별개).
  const [visibleRegion, setVisibleRegion] = useState<Region>(INITIAL_REGION);
  // 줌 계산에 지도 뷰의 가로 폭이 필요하다(같은 longitudeDelta라도 화면이 넓으면 더 축소된 상태).
  // 지도는 화면 전체를 채우므로 창 폭을 그대로 쓰고, 회전 시에도 자동으로 갱신된다.
  const { width } = useWindowDimensions();
  // 값을 담지 않은 초기 상태 = 전부 켜짐. 판정은 모두 `!== false`로 하므로 미등록 카테고리도
  // 기본으로 보인다(예전엔 키를 빠뜨리면 그 카테고리가 통째로 숨는 함정이 있었다).
  const [activeCategories, setActiveCategories] = useState<Record<string, boolean>>({});
  // 축척 판정 기준 — region.longitudeDelta에서 계산한 줌 레벨을 정수로 내린 값.
  //  - latitudeDelta를 쓰지 않는 이유: Mercator에서 세로 축척은 중심 위도에 비례해(∝ cos(lat))
  //    변해서, 줌을 건드리지 않고 남북으로 팬만 해도 값이 흔들린다. 가로 축척은 위도와 무관하다.
  //  - 정수로 버리는 이유: 지도 자체는 소수 줌으로 부드럽게 움직이되(스냅하지 않는다) 마커 노출
  //    판정만 카카오 level처럼 정수 단계로 다룬다. 정수 경계를 넘을 때만 state가 바뀌므로
  //    핀치 중 미세한 줌 변화마다 500개 마커를 다시 만드는 일도 없어진다.
  //  - round가 아니라 floor인 이유: 타일 줌 레벨은 "13.0에 도달하기 전까지 12단계"라는 의미라
  //    내림이 맞다. round를 쓰면 경계가 12.5로 밀려서, 줌 12단계인데도 12.5~12.99 구간에서
  //    showFromZoom:13 카테고리가 그대로 보이는 문제가 생긴다.
  const [zoom, setZoom] = useState(() =>
    Math.floor(zoomFromLongitudeDelta(INITIAL_REGION.longitudeDelta, width)),
  );
  // 상세 시트를 띄울 관광지. 시트는 ref로 present/dismiss하고(Gorhom 표준), 이 state는
  // 시트 안에 무엇을 그릴지와 상세 조회(GET /api/spots/:id)를 켜는 스위치 역할을 한다.
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const detailSheetRef = useRef<BottomSheetModal>(null);
  const { claim, select: selectClaimSpot } = useSpotClaim();

  useImperativeHandle(
    ref,
    () => ({
      // 부분 카메라는 현재 카메라에 병합되므로 줌/각도는 그대로 두고 중심만 옮긴다 —
      // 현재 delta를 따로 들고 있을 필요가 없다.
      panTo: (c: Coords) => mapRef.current?.animateCamera({ center: c }, { duration: 300 }),
    }),
    [],
  );

  const handleRegionChangeComplete = useCallback(
    (region: Region) => {
      setVisibleRegion(region);
      // 같은 값으로 setState하면 React가 리렌더를 건너뛰므로 별도 비교 없이 그냥 넣는다.
      setZoom(Math.floor(zoomFromLongitudeDelta(region.longitudeDelta, width)));

      const clamped = clampRegionCenter(region);
      if (clamped) mapRef.current?.animateToRegion(clamped, 150);
    },
    [width],
  );

  const handleToggleCategory = useCallback((id: string) => {
    setActiveCategories((prev) => ({ ...prev, [id]: prev[id] === false }));
  }, []);

  const handleToggleAll = useCallback(() => {
    setActiveCategories((prev) => {
      const turnOn = Object.values(prev).some((v) => v === false);
      return Object.fromEntries(ALL_CATEGORY_KEYS.map((id) => [id, turnOn]));
    });
  }, []);

  const handleSpotPress = useCallback((spot: Spot) => selectClaimSpot(spot.id), [selectClaimSpot]);

  const handleSpotSelect = useCallback((spot: Spot) => {
    setSelectedSpot(spot);
    detailSheetRef.current?.present();
  }, []);

  const handleDetailDismiss = useCallback(() => setSelectedSpot(null), []);

  // 좌표 파싱은 관광지 목록이 바뀔 때만 하면 된다. 렌더마다 하면 500개 × 2회 파싱이 반복되고,
  // 매번 새 coordinate 객체가 생겨 SpotMarker의 memo가 무력화된다.
  const spotPoints = useMemo(() => toSpotPoints(spots), [spots]);
  const spotMarkers = buildSpotMarkers(spotPoints, {
    activeCategories,
    zoom,
    region: visibleRegion,
    claim,
    onPress: handleSpotPress,
    onSelect: handleSpotSelect,
  });

  return (
    <View style={style}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        initialRegion={INITIAL_REGION}
        minZoomLevel={BUSAN_MIN_ZOOM_LEVEL}
        maxZoomLevel={BUSAN_MAX_ZOOM_LEVEL}
        // 기본값이 둘 다 true라 두 손가락 드래그에 회전/기울임(3D tilt)이 섞여 들어가기 쉬운데,
        // 기울어지면 화면에 보이는 위경도 범위가 원근 때문에 바뀌어 순수 팬만 했는데도
        // latitudeDelta가 흔들리는 것처럼 보인다. 이 지도는 구역 색칠을 보여주는 탑뷰라
        // 회전/기울임 자체가 필요 없어 꺼서 순수 팬/줌만 되게 한다(카카오 버전도 평면 2D였음).
        rotateEnabled={false}
        pitchEnabled={false}
        onRegionChangeComplete={handleRegionChangeComplete}
        onMapReady={onReady}
      >
        <DistrictPolygons />
        {spotMarkers}
        {coords && <CurrentLocationMarker coordinate={coords} />}
      </MapView>
      <CategoryFilterPanel
        activeCategories={activeCategories}
        onToggleCategory={handleToggleCategory}
        onToggleAll={handleToggleAll}
        zoom={zoom}
      />
      <SpotDetailSheet
        ref={detailSheetRef}
        spot={selectedSpot}
        // 다른 마커를 탭해 선택이 옮겨간 뒤라면 이 시트의 관광지와 맞지 않으므로 숨긴다
        claimText={claim?.spotId === selectedSpot?.id ? (claim?.text ?? null) : null}
        onDismiss={handleDetailDismiss}
      />
    </View>
  );
});
