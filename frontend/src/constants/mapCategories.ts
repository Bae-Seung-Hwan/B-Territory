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
// map.categories.<id>가 단일 소스이고, CategoryFilterPanel이 useTranslation()으로
// 직접 조회한다(색/이모지는 언어와 무관해 그대로 여기 남긴다).
export interface CategoryMeta {
  color: string;
  emoji: string;
  showFromZoom: number | null;
}

export const CATEGORY_META: Record<string, CategoryMeta> = {
  '12': { color: '#3987e5', emoji: '📍', showFromZoom: 12 },
  '14': { color: '#9085e9', emoji: '🏛', showFromZoom: 12 },
  '15': { color: '#d55181', emoji: '🎪', showFromZoom: 12 },
  '25': { color: '#199e70', emoji: '🚶', showFromZoom: 12 },
  '28': { color: '#d95926', emoji: '🏄', showFromZoom: 12 },
  '38': { color: '#e66767', emoji: '🛍', showFromZoom: 13 },
  '39': { color: '#008300', emoji: '🍴', showFromZoom: 13 },
};

const DEFAULT_CATEGORY_META: CategoryMeta = {
  color: '#898781',
  emoji: '📌',
  showFromZoom: 14,
};

export const DEFAULT_CATEGORY_KEY = 'default';

/**
 * 어떤 카테고리든 마커가 보이기 시작하는 가장 낮은 줌. 이보다 축소하면 지도에 마커가 하나도 없다.
 * 값을 따로 적지 않고 위 표에서 파생시키는 이유: 노출 기준을 조정할 때 "마커가 없는 축척"의
 * 정의가 저절로 따라오게 하기 위함이다(지도는 그 구간에서 구 단위 조작으로 전환된다).
 */
export const MIN_CATEGORY_SHOW_ZOOM = Math.min(
  ...[...Object.values(CATEGORY_META), DEFAULT_CATEGORY_META]
    .map((meta) => meta.showFromZoom)
    .filter((zoom): zoom is number => zoom != null),
);

export function getCategoryMeta(contenttypeid: string | null | undefined): CategoryMeta {
  return (contenttypeid && CATEGORY_META[contenttypeid]) || DEFAULT_CATEGORY_META;
}

export function categoryKey(contenttypeid: string | null | undefined): string {
  return contenttypeid && CATEGORY_META[contenttypeid] ? contenttypeid : DEFAULT_CATEGORY_KEY;
}
