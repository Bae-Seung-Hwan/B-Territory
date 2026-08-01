import { CATEGORY_META, categoryKey, getCategoryMeta } from '@/constants/mapCategories';

// KakaoMapView.tsx(WebView)의 isMarkerVisible과 동일 책임 — 마커가 보이려면
// (1) 필터가 켜져 있고 (2) 현재 축척이 노출 기준 안이어야 한다. 기준값은 Google Maps
// 카메라 줌 레벨(클수록 확대)이라, 카카오 level이나 latitudeDelta와 부등호 방향이 반대다.
export function isCategoryVisible(
  contenttypeid: string | null | undefined,
  zoom: number,
  activeCategories: Record<string, boolean>,
): boolean {
  if (!activeCategories[categoryKey(contenttypeid)]) return false;
  const { showFromZoom } = getCategoryMeta(contenttypeid);
  return showFromZoom == null || zoom >= showFromZoom;
}

// 필터 칩의 "축척 때문에 자동으로 숨겨짐(zoom-hidden)" 표시에 쓰인다.
export function isCategoryZoomHidden(categoryId: string, zoom: number): boolean {
  const showFromZoom = CATEGORY_META[categoryId]?.showFromZoom;
  return showFromZoom != null && zoom < showFromZoom;
}
