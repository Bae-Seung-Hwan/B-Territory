// 실제 인접 그래프를 그래프 컬러링(4색 정리)해서 배정 — 서로 맞닿은 구끼리는 절대 같은
// 색을 쓰지 않는다. KakaoMapView.tsx(WebView)의 DISTRICT_FILL_COLORS를 그대로 이식.
const DISTRICT_FALLBACK_COLORS: Record<string, string> = {
  '26110': '#3987e5', // 중구 - blue
  '26140': '#c98500', // 서구 - yellow
  '26170': '#d55181', // 동구 - magenta
  '26200': '#d55181', // 영도구 - magenta
  '26230': '#3987e5', // 부산진구 - blue
  '26260': '#c98500', // 동래구 - yellow
  '26290': '#c98500', // 남구 - yellow
  '26320': '#008300', // 북구 - green
  '26350': '#3987e5', // 해운대구 - blue
  '26380': '#3987e5', // 사하구 - blue
  '26410': '#d55181', // 금정구 - magenta
  '26440': '#c98500', // 강서구 - yellow
  '26470': '#d55181', // 연제구 - magenta
  '26500': '#008300', // 수영구 - green
  '26530': '#d55181', // 사상구 - magenta
  '26710': '#c98500', // 기장군 - yellow
};

const DEFAULT_FALLBACK_COLOR = '#4FC3F7';

// 아래 세 값은 "구를 어떻게 칠하는가"를 채움 팔레트와 한 파일에 모아두기 위해 여기 둔다.

/** 구 경계선 색. 옅은 채움 위에서도 경계가 또렷하게 읽히도록 검정에 가깝게 쓴다. */
export const DISTRICT_STROKE_COLOR = '#4e4b4b';
export const DISTRICT_STROKE_WIDTH = 1;

/** 부산 바깥을 덮는 마스크 색 — 구 경계 안쪽만 밝게 남겨 시선을 부산으로 모은다 */
export const OUTSIDE_MASK_COLOR = '#000000';
export const OUTSIDE_MASK_ALPHA = 0.45;

/** 이번 주 수도 강조 — 나머지 15개 구의 채움색과 겹치지 않는 금색으로 테두리를 두껍게 그린다 */
export const CAPITAL_STROKE_COLOR = '#FFD700';
export const CAPITAL_STROKE_WIDTH = 4;
export const CAPITAL_FILL_ALPHA = 0.18;

// TODO: 실제 점령(occupy) 기능이 붙으면 국적/팀 코드 → 색상 매핑을 정의해 이 함수를 확장한다.
// 점령 상태는 useGameStore.occupiedDistricts가 이미 들고 있으므로(MapHUD가 같은 방식으로 읽는다)
// DistrictPolygons가 그 스토어를 직접 구독하면 된다 — prop으로 내려보낼 필요가 없다.
export function getDistrictFillColor(sigCd: string): string {
  return DISTRICT_FALLBACK_COLORS[sigCd] || DEFAULT_FALLBACK_COLOR;
}
