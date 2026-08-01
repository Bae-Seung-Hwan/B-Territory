import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle, useWindowDimensions } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useQuery } from '@tanstack/react-query';
import type { Spot } from '@/api/spots';
import { fetchSpotClaim } from '@/api/claims';
import { queryKeys } from '@/lib/query-keys';
import { useTranslation } from '@/i18n';
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
import { buildSpotMarkers } from './SpotMarkers';

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

// CATEGORY_META에 없는 contenttypeid(TourAPI 미분류)는 DEFAULT_CATEGORY_KEY로 묶여
// 필터링되므로, 그 키도 항상 초기값을 가져야 한다(빠지면 매칭 안 되는 스팟이 전부 숨겨짐).
const ALL_CATEGORY_KEYS = [...Object.keys(CATEGORY_META), DEFAULT_CATEGORY_KEY];

function initialActiveCategories(): Record<string, boolean> {
  return Object.fromEntries(ALL_CATEGORY_KEYS.map((id) => [id, true]));
}

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
  // 점령(occupy) 기능이 지도에 연동될 때 채워질 확장 포인트 — 지금은 항상 undefined이고,
  // DistrictPolygons는 그 경우 그래프 컬러링 폴백 팔레트로 그린다.
  occupiedDistricts?: Record<string, string>;
  onDistrictPress?: (sigCd: string) => void;
}

export const BusanMapView = forwardRef<BusanMapViewHandle, BusanMapViewProps>(function BusanMapView(
  { style, spots = [], coords = null, onReady, occupiedDistricts, onDistrictPress },
  ref,
) {
  const mapRef = useRef<MapView>(null);
  const regionRef = useRef<Region>(INITIAL_REGION);
  const { t } = useTranslation();
  // 뷰포트 필터링용 — 화면에 보이는 영역이 바뀌면 렌더링할 마커 집합도 다시 계산해야 하므로
  // ref가 아니라 state로 들고 있어야 한다(팬만 해도 갱신되어야 하니 zoom과는 별개).
  const [visibleRegion, setVisibleRegion] = useState<Region>(INITIAL_REGION);
  // 줌 계산에 지도 뷰의 가로 폭이 필요하다(같은 longitudeDelta라도 화면이 넓으면 더 축소된 상태).
  // 지도는 화면 전체를 채우므로 창 폭을 그대로 쓰고, 회전 시에도 자동으로 갱신된다.
  const { width } = useWindowDimensions();
  const [activeCategories, setActiveCategories] = useState<Record<string, boolean>>(initialActiveCategories);
  // 축척 판정 기준 — region.longitudeDelta에서 계산한 줌 레벨을 정수로 내린 값.
  //  - latitudeDelta를 쓰지 않는 이유: Mercator에서 세로 축척은 중심 위도에 비례해(∝ cos(lat))
  //    변해서, 줌을 건드리지 않고 남북으로 팬만 해도 값이 흔들린다. 가로 축척은 위도와 무관하다.
  //  - 정수로 버리는 이유: 지도 자체는 소수 줌으로 부드럽게 움직이되(스냅하지 않는다) 마커 노출
  //    판정만 카카오 level처럼 정수 단계로 다룬다. 정수 경계를 넘을 때만 state가 바뀌므로
  //    핀치 중 미세한 줌 변화마다 500개 마커를 다시 만드는 일도 없어진다.
  //  - round가 아니라 floor인 이유: 타일 줌 레벨은 "13.0에 도달하기 전까지 12단계"라는 의미라
  //    내림이 맞다. round를 쓰면 경계가 12.5로 밀려서, 줌 12단계인데도 12.5~12.99 구간에서
  //    showFromZoom:13 카테고리가 그대로 보이는 문제가 생긴다.
  const initialZoom = Math.floor(zoomFromLongitudeDelta(INITIAL_REGION.longitudeDelta, width));
  const [zoom, setZoom] = useState(initialZoom);
  // 최신 zoom을 콜백에서 stale closure 없이 읽기 위한 사본
  const zoomRef = useRef(initialZoom);
  // 상세 시트를 띄울 관광지. 시트는 ref로 present/dismiss하고(Gorhom 표준), 이 state는
  // 시트 안에 무엇을 그릴지와 상세 조회(GET /api/spots/:id)를 켜는 스위치 역할을 한다.
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const detailSheetRef = useRef<BottomSheetModal>(null);

  // 말풍선에 띄울 점령 현황. 마커 컴포넌트가 아니라 여기서 들고 있는 이유:
  //  - 마커를 탭하면 Android가 말풍선을 보이려 카메라를 살짝 옮기고, 그러면 뷰포트 필터가
  //    다시 돌면서 그 마커가 잠깐 언마운트될 수 있다. 상태를 마커 안에 두면 그때 초기화되어
  //    조회가 영영 시작되지 않는다.
  //  - 점령 API는 관광지별 개별 엔드포인트뿐이라 화면의 모든 마커가 각자 조회하면 요청이
  //    폭증한다. 마지막으로 탭한 하나만 조회한다.
  const [claimSpotId, setClaimSpotId] = useState<number | null>(null);
  const {
    data: claim,
    isError: isClaimError,
    isFetching: isClaimFetching,
    dataUpdatedAt: claimDataUpdatedAt,
    errorUpdatedAt: claimErrorUpdatedAt,
    refetch: refetchClaim,
  } = useQuery({
    queryKey: queryKeys.claims.spot(claimSpotId ?? 0),
    queryFn: () => fetchSpotClaim(claimSpotId!),
    enabled: claimSpotId != null,
    // 점령 상태는 수시로 바뀌므로 탭할 때마다 항상 새로 받는다. 캐시를 남기면 다음 탭에서
    // 낡은 값이 먼저 보이므로 보관하지 않는다.
    staleTime: 0,
    gcTime: 0,
    // 실패 시 기본 3회 재시도는 말풍선이 뜨기까지 너무 오래 걸린다(백오프 포함 ~7초).
    retry: 1,
  });

  // 조회가 끝났을 때만(성공이든 실패든) 문구를 만든다. 조회 중에는 null을 유지해서,
  // 마커가 말풍선을 아직 열지 않도록 한다 — Android 말풍선은 열리는 순간의 내용을 비트맵으로
  // 한 번 찍고 그 뒤로는 갱신되지 않기 때문에, 완성된 내용을 갖춘 뒤에 열어야 한다.
  const isClaimSettled = claimSpotId != null && !isClaimFetching && (claim !== undefined || isClaimError);
  const claimText = !isClaimSettled
    ? null
    : isClaimError
      ? t('map.claim.loadFailed')
      : claim?.team
        ? t('map.claim.claimedBy', { team: claim.team })
        : t('map.claim.unclaimed');
  // 말풍선을 열 시점을 알리는 신호. 문구가 아니라 "조회가 끝난 시각"을 쓰는 이유는, 같은 마커를
  // 다시 탭했을 때 결과가 이전과 같으면(예: 계속 미점령) 문구가 안 바뀌어 열림 신호를 놓치기 때문이다.
  // 이 값은 조회가 성공/실패로 끝날 때마다 갱신된다.
  const claimSettledAt = isClaimSettled ? Math.max(claimDataUpdatedAt, claimErrorUpdatedAt) : 0;

  useImperativeHandle(
    ref,
    () => ({
      panTo: (c: Coords) => {
        mapRef.current?.animateToRegion(
          {
            latitude: c.latitude,
            longitude: c.longitude,
            latitudeDelta: regionRef.current.latitudeDelta,
            longitudeDelta: regionRef.current.longitudeDelta,
          },
          300,
        );
      },
    }),
    [],
  );

  const handleRegionChangeComplete = useCallback(
    (region: Region) => {
      regionRef.current = region;
      setVisibleRegion(region);

      const rawZoom = zoomFromLongitudeDelta(region.longitudeDelta, width);
      const nextZoom = Math.floor(rawZoom);
      if (nextZoom !== zoomRef.current) {
        // showFromZoom(mapCategories.ts) 기준값을 실기기에서 맞출 때 참고용 — 프로덕션엔 남기지
        // 않는다. 내림 전 원본도 같이 남겨야 "13.9라서 아직 13단계다" 같은 판단이 가능하다.
        if (__DEV__) {
          console.log('[BusanMapView] zoom', zoomRef.current, '->', nextZoom, `(raw ${rawZoom.toFixed(2)})`);
        }
        zoomRef.current = nextZoom;
        setZoom(nextZoom);
      }

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

  // 같은 마커를 다시 탭하면 id가 그대로라 쿼리가 저절로 다시 돌지 않으므로 명시적으로 refetch한다.
  const handleSpotPress = useCallback(
    (spot: Spot) => {
      if (spot.id === claimSpotId) refetchClaim();
      else setClaimSpotId(spot.id);
    },
    [claimSpotId, refetchClaim],
  );

  const handleSpotSelect = useCallback((spot: Spot) => {
    setSelectedSpot(spot);
    detailSheetRef.current?.present();
  }, []);

  const handleDetailDismiss = useCallback(() => setSelectedSpot(null), []);

  const spotMarkers = buildSpotMarkers(spots, {
    activeCategories,
    zoom,
    region: visibleRegion,
    claimSpotId,
    claimText,
    claimSettledAt,
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
        <DistrictPolygons occupiedDistricts={occupiedDistricts} onDistrictPress={onDistrictPress} />
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
        // 다른 마커를 탭해 claimSpotId가 옮겨간 뒤라면 이 시트의 관광지와 맞지 않으므로 숨긴다
        claimText={selectedSpot != null && selectedSpot.id === claimSpotId ? claimText : null}
        onDismiss={handleDetailDismiss}
      />
    </View>
  );
});
