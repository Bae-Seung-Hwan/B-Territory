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

// TODO: 실제 점령(occupy) 기능이 붙으면 국적/팀 코드 → 색상 매핑을 정의하고, occupiedDistricts에
// sigCd 항목이 있을 때 그 매핑을 우선 사용하도록 이 함수를 확장한다. 지금은 occupiedDistricts가
// 항상 undefined로 넘어오므로 그래프 컬러링 폴백 팔레트만 쓰인다.
export function getDistrictFillColor(
  sigCd: string,
  _occupiedDistricts?: Record<string, string>,
): string {
  return DISTRICT_FALLBACK_COLORS[sigCd] || DEFAULT_FALLBACK_COLOR;
}
