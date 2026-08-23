// 위도 1도는 지구 어디서든 약 111.32km로 고정된다 — latitudeDelta는 이 상수 하나로 미터 환산이
// 가능하다(경도 1도의 실거리는 위도에 따라 달라지지만, 부산처럼 좁은 위도 범위(34.8~35.4°N)에서는
// 위도 델타 기준 근사만으로 실용적으로 충분하다).
const METERS_PER_LAT_DEGREE = 111_320;

export function metersToLatDelta(meters: number): number {
  return meters / METERS_PER_LAT_DEGREE;
}

// Web Mercator 타일 크기(줌 0에서 전 세계가 이 폭에 들어간다)
const TILE_SIZE = 256;

// region.longitudeDelta로부터 Google Maps 줌 레벨을 계산한다.
//
// 유도: 줌 Z에서 전 세계(경도 360도)의 폭은 TILE_SIZE * 2^Z. 지도 뷰 폭이 W일 때 화면에 보이는
// 경도 범위가 longitudeDelta이므로  longitudeDelta = 360 * W / (TILE_SIZE * 2^Z)  이고,
// 이를 Z에 대해 풀면 아래 식이 된다.
//
// latitudeDelta가 아니라 longitudeDelta를 쓰는 이유: Mercator에서 세로 축척은 중심 위도에 따라
// 달라져(latitudeDelta ∝ cos(lat)) 줌을 그대로 둔 채 남북으로 팬만 해도 값이 변하지만,
// 가로 축척은 위도와 무관해 같은 줌이면 longitudeDelta가 항상 일정하다.
//
// getCamera().zoom 대신 이 계산을 쓰는 이유: Camera.zoom은 타입상 optional이라 값이 없으면
// 줌 갱신이 통째로 멈춰버리는(그래서 마커가 영영 안 사라지는) 실패 모드가 있는데,
// longitudeDelta는 onRegionChangeComplete가 항상 동기적으로 넘겨주므로 그런 구멍이 없다.
export function zoomFromLongitudeDelta(longitudeDelta: number, viewportWidth: number): number {
  return Math.log2((360 * viewportWidth) / (TILE_SIZE * longitudeDelta));
}

const EARTH_RADIUS_M = 6_371_000;

/** 두 좌표 사이의 대권거리(미터). 소규모 지역(부산 시내) 근접 판정에만 쓴다. */
export function haversineDistanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
