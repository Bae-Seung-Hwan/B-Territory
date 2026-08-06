/**
 * 부산 구·군 코드 두 체계를 잇는 표.
 *
 *   SIG_CD      : 통계청 행정구역 코드 5자리. assets/geo/busan_sig.json의 폴리곤이 쓴다.
 *   sigungucode : TourAPI가 쓰는 부산 내 일련번호(1~16). 백엔드 spots/districts/claims가 쓴다.
 *
 * 두 값 사이에 계산 규칙이 없어 표로 들고 있을 수밖에 없다. 지도에서 구 폴리곤을 탭하면
 * SIG_CD를 얻는데 API는 sigungucode를 요구하므로, 그 사이를 여기서 변환한다.
 *
 * 이 표는 손으로 적은 것이 아니라 GeoJSON의 SIG_KOR_NM/SIG_ENG_NM과 GET /api/districts의
 * nameKo/nameEn을 대조해 생성했다(16/16 일치, 한글·영문 결과 동일, 코드 중복·누락 없음).
 * 구 경계 데이터나 백엔드 구 목록이 바뀌면 같은 방식으로 다시 대조해야 한다.
 */
export const SIG_CD_TO_SIGUNGU_CODE: Record<string, string> = {
  '26110': '15', // 중구
  '26140': '11', // 서구
  '26170': '5', // 동구
  '26200': '14', // 영도구
  '26230': '7', // 부산진구
  '26260': '6', // 동래구
  '26290': '4', // 남구
  '26320': '8', // 북구
  '26350': '16', // 해운대구
  '26380': '10', // 사하구
  '26410': '2', // 금정구
  '26440': '1', // 강서구
  '26470': '13', // 연제구
  '26500': '12', // 수영구
  '26530': '9', // 사상구
  '26710': '3', // 기장군
};

/** 폴리곤에서 얻은 SIG_CD를 백엔드 조회용 sigungucode로 바꾼다. 표에 없으면 null. */
export function toSigunguCode(sigCd: string): string | null {
  return SIG_CD_TO_SIGUNGU_CODE[sigCd] ?? null;
}
