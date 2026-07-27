// KakaoMapView(지도 중심/드래그 제한)와 map/index.tsx(현재 위치가 부산 범위 밖인지 판정)가
// 동일한 좌표 기준을 공유해야 하므로 단일 소스로 둔다.
export const BUSAN_CENTER = { lat: 35.1796, lng: 129.0756 };

export const BUSAN_BOUNDS = { minLat: 34.83, maxLat: 35.44, minLng: 128.71, maxLng: 129.36 };

export function isWithinBusanBounds(lat: number, lng: number): boolean {
  return (
    lat >= BUSAN_BOUNDS.minLat &&
    lat <= BUSAN_BOUNDS.maxLat &&
    lng >= BUSAN_BOUNDS.minLng &&
    lng <= BUSAN_BOUNDS.maxLng
  );
}
