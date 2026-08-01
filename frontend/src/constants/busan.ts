import { metersToLatDelta } from '@/utils/geo';

// KakaoMapView(지도 중심/드래그 제한)와 map/index.tsx(현재 위치가 부산 범위 밖인지 판정)가
// 동일한 좌표 기준을 공유해야 하므로 단일 소스로 둔다.
export const BUSAN_CENTER = { lat: 35.1796, lng: 129.0756 };

export const BUSAN_BOUNDS = { minLat: 34.83, maxLat: 35.44, minLng: 128.71, maxLng: 129.36 };

// 초기 화면 폭 ~1km — 카카오 버전의 초기 level 7("실측상 레벨 7부터 화면 폭이 1km를 넘어간다")과
// 동일한 물리적 크기다. 실제 줌 레벨은 화면 폭에 따라 달라지므로(utils/geo.ts의
// zoomFromLongitudeDelta 참고) 여기서 상수로 못 박지 않고 BusanMapView가 런타임에 계산한다.
export const BUSAN_INITIAL_DELTA = {
  latitudeDelta: metersToLatDelta(1000),
  longitudeDelta: metersToLatDelta(1000),
};

// react-native-maps의 minZoomLevel/maxZoomLevel(Google 줌 스케일, 0~20)로 지도 확대/축소
// 한계를 네이티브에서 직접 제한한다(카카오의 setMaxLevel(11)에 대응).
// 일반적인 폰 화면 폭(360~430dp) 기준으로 10 ≈ 화면 폭 45~54km(부산 전역이 한눈에),
// 16 ≈ 화면 폭 1km(거리 단위) 수준이다.
export const BUSAN_MIN_ZOOM_LEVEL = 10;
export const BUSAN_MAX_ZOOM_LEVEL = 18;

export function isWithinBusanBounds(lat: number, lng: number): boolean {
  return (
    lat >= BUSAN_BOUNDS.minLat &&
    lat <= BUSAN_BOUNDS.maxLat &&
    lng >= BUSAN_BOUNDS.minLng &&
    lng <= BUSAN_BOUNDS.maxLng
  );
}
