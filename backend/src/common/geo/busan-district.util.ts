/**
 * 부산 구/군 식별 공용 지식. **시더와 축제 동기화가 반드시 같은 체계를 써야 해서** 여기 모았다.
 *
 * festivals.sigungucode·spots.sigungucode는 구 단위 집계(GROUP BY sigungucode)의 키다.
 * 한쪽이 KTO 코드를, 다른 쪽이 법정동 코드나 구 이름을 넣으면 같은 구가 둘로 쪼개진다.
 */

/** KTO 표준 부산(areaCode=6) 시군구 코드표 (가나다순 1~16). */
export const BUSAN_SIGUNGU_CODE_BY_NAME: Record<string, string> = {
  강서구: '1',
  금정구: '2',
  기장군: '3',
  남구: '4',
  동구: '5',
  동래구: '6',
  부산진구: '7',
  북구: '8',
  사상구: '9',
  사하구: '10',
  서구: '11',
  수영구: '12',
  연제구: '13',
  영도구: '14',
  중구: '15',
  해운대구: '16',
};

export const VALID_SIGUNGU_CODES = new Set(
  Object.values(BUSAN_SIGUNGU_CODE_BY_NAME),
);

/**
 * 주소 문자열에서 부산 구/군 이름을 추출한다 (매핑 테이블에 있는 이름만 인식).
 * 못 찾으면 null.
 */
export function districtNameFromAddress(address: string): string | null {
  for (const name of Object.keys(BUSAN_SIGUNGU_CODE_BY_NAME)) {
    const idx = address.indexOf(name);
    if (idx === -1) continue;
    // 앞 글자가 한글 음절이면 더 긴 이름의 일부다(예: "강남구" 안의 "남구"). 이 경우는
    // 부산 구/군이 아니므로 건너뛴다 — 구 이름은 "시/도/공백" 뒤에 토큰으로 나온다.
    const prev = idx === 0 ? '' : address[idx - 1];
    if (/[가-힣]/.test(prev)) continue;
    return name;
  }
  return null;
}

/** 주소 → KTO 시군구코드. 구 이름을 못 찾으면 null. */
export function ktoSigunguFromAddress(address: string): string | null {
  const name = districtNameFromAddress(address);
  return name ? BUSAN_SIGUNGU_CODE_BY_NAME[name] : null;
}
