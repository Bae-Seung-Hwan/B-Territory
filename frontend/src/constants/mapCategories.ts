// TourAPI contenttypeid별 마커 설정 — 카테고리 동작의 단일 소스(마커 아이콘, 필터 패널,
// 줌 기반 자동 숨김이 모두 이 표를 참조한다). 원래 KakaoMapView.tsx(WebView) 안에 있던
// CATEGORY_META를 그대로 이식했다.
//   showFromZoom: Google Maps 카메라 줌 레벨(0=지구 전체 ~ 20=건물, 클수록 확대)이 이 값
//                 이상일 때만 마커를 보여준다. null이면 항상 표시.
//                 한때 latitudeDelta 기준(hideFromDelta)이었으나, Mercator 투영에서
//                 latitudeDelta는 중심 위도에 비례해(∝ cos(lat)) 변하기 때문에 줌을 전혀
//                 건드리지 않고 남북으로 팬하기만 해도 값이 흔들렸다(부산 남단↔북단 0.75%).
//                 카메라 zoom은 팬에 전혀 영향받지 않아 축척 판정의 올바른 기준이다.
// label(카테고리 표시 이름)은 여기 두지 않는다 — i18n/locales/{ko,en}.ts의
// map.categoryFilter.categories.<id>가 단일 소스이고, CategoryFilterPanel이 useTranslation()으로
// 직접 조회한다(색/이모지는 언어와 무관해 그대로 여기 남긴다).
export interface CategoryMeta {
  color: string;
  emoji: string;
  showFromZoom: number | null;
}

// 관광지/문화시설처럼 수가 적고 눈에 띄어야 하는 카테고리는 더 축소된 상태(낮은 줌)에서도
// 남겨두고, 숙박/쇼핑/음식점처럼 밀집도가 높은 카테고리는 한 단계 더 확대해야 나타나게 해
// 혼잡도를 낮춘다 — 원래 카카오 hideFromLevel 8 vs 7의 의도를 그대로 유지.
// 값은 직전 delta 기준(5km/3km 화면 폭)을 환산한 시작점이며 실기기에서 재보정 가능하다.
const WIDE_SHOW_ZOOM = 13;
const NARROW_SHOW_ZOOM = 14;

export const CATEGORY_META: Record<string, CategoryMeta> = {
  '12': { color: '#3987e5', emoji: '📍', showFromZoom: WIDE_SHOW_ZOOM },
  '14': { color: '#9085e9', emoji: '🏛', showFromZoom: WIDE_SHOW_ZOOM },
  '15': { color: '#d55181', emoji: '🎪', showFromZoom: WIDE_SHOW_ZOOM },
  '25': { color: '#199e70', emoji: '🚶', showFromZoom: WIDE_SHOW_ZOOM },
  '28': { color: '#d95926', emoji: '🏄', showFromZoom: WIDE_SHOW_ZOOM },
  '32': { color: '#c98500', emoji: '🏠', showFromZoom: NARROW_SHOW_ZOOM },
  '38': { color: '#e66767', emoji: '🛍', showFromZoom: NARROW_SHOW_ZOOM },
  '39': { color: '#008300', emoji: '🍴', showFromZoom: NARROW_SHOW_ZOOM },
};

export const DEFAULT_CATEGORY_META: CategoryMeta = {
  color: '#898781',
  emoji: '📌',
  showFromZoom: NARROW_SHOW_ZOOM,
};

export const DEFAULT_CATEGORY_KEY = 'default';

export function getCategoryMeta(contenttypeid: string | null | undefined): CategoryMeta {
  return (contenttypeid && CATEGORY_META[contenttypeid]) || DEFAULT_CATEGORY_META;
}

export function categoryKey(contenttypeid: string | null | undefined): string {
  return contenttypeid && CATEGORY_META[contenttypeid] ? contenttypeid : DEFAULT_CATEGORY_KEY;
}
