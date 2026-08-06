/**
 * 응답 로컬라이제이션용 언어 리졸버.
 *
 * 프론트는 조회 시 `lang` 쿼리로 언어코드(ko/en) 또는 국가코드(KR/US/…)를 보낼 수 있다.
 * 현재 지원 언어는 한국어/영어 2종이므로, 한국(=KR) 계열이면 한국어, 그 외 국가코드는
 * 영어로 폴백한다. 값이 없으면 서비스 기본 언어인 한국어.
 */
export type Lang = 'ko' | 'en';

export function resolveLang(raw?: string | null): Lang {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return 'ko';
  if (v === 'ko' || v === 'kr' || v === 'ko-kr' || v === 'ko_kr') return 'ko';
  if (v === 'en') return 'en';
  // 그 외 국가코드(US, GB, JP, …)는 지원 언어가 한/영뿐이라 영어로 폴백한다.
  return 'en';
}

/**
 * 요청 언어에 맞는 텍스트를 고른다. 영어를 요청했지만 영문 원본이 없으면(en=null)
 * 한국어로 폴백한다 — 영문 설명 데이터가 아직 채워지지 않은 spot을 위한 안전장치.
 */
export function pickText(
  ko: string | null | undefined,
  en: string | null | undefined,
  lang: Lang,
): string | null {
  if (lang === 'en') return en ?? ko ?? null;
  return ko ?? null;
}
