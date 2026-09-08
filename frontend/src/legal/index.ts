import { termsOfService } from './terms-of-service';
import { privacyPolicy } from './privacy-policy';
import { locationTerms } from './location-terms';
import type { LegalDocument } from './types';

export type { LegalDocument } from './types';

/**
 * 가입 시 동의를 받는 문서의 종류. 값은 서버에 동의 이력으로 남길 식별자이므로
 * 한 번 정하면 바꾸지 않는다(바꾸면 이미 쌓인 이력과 연결이 끊긴다).
 */
export type LegalDocumentKey = 'service' | 'privacy' | 'location';

/**
 * 문서 정의의 단일 소스. `Record<LegalDocumentKey, …>`라 키를 하나라도 빠뜨리면 컴파일이
 * 깨지므로, 여기에 등록되지 않은 문서는 존재할 수 없다. **선언 순서가 곧 화면 표시 순서다.**
 */
export const LEGAL_DOCUMENTS: Record<LegalDocumentKey, LegalDocument> = {
  service: termsOfService,
  privacy: privacyPolicy,
  location: locationTerms,
};

/**
 * 화면 표시 순서 겸, 동의 항목을 빠짐없이 순회하기 위한 목록.
 *
 * 손으로 적은 배열이 아니라 `LEGAL_DOCUMENTS`에서 **파생**시킨다. 예전엔 리터럴 배열이었는데
 * 타입이 `readonly LegalDocumentKey[]`라 부분집합도 만족했다 — 네 번째 문서를
 * `LegalDocumentKey`와 `LEGAL_DOCUMENTS`에 추가하고 이 배열에만 빠뜨리면, `tsc`는 깨끗한 채로
 * 그 문서의 동의 항목만 화면에서 조용히 사라진다. 개별 `useState`를 맵으로 바꿔 닫으려던
 * 실패 모드("하나를 빠뜨리면 동의를 받지 않은 문서가 조용히 생긴다")가 한 층 위에서
 * 되살아난 형태였다. 파생시키면 위 Record의 망라성 검사가 그대로 이 목록을 보장한다.
 */
export const LEGAL_DOCUMENT_KEYS = Object.keys(LEGAL_DOCUMENTS) as readonly LegalDocumentKey[];

/**
 * 해당 언어의 조항 전문. 지원하지 않는 locale이면 기본 언어(en)로 떨어진다.
 *
 * 호출부가 `body[locale]`로 직접 인덱싱하면 안 된다 — `useTranslation()`이 주는 locale은
 * `i18n.locale as Locale`이라는 unchecked cast라 `'ko'|'en'`을 벗어날 수 있고, 그때
 * `i18n.t()`는 fallback으로 영어까지 degrade되는 반면 객체 인덱싱은 `undefined`가 된다.
 * 결과는 **조항 전문이 빈 화면인 채로 "(필수) 동의"를 요구하는** 상태다. 본문이 보이지
 * 않는 동의는 받으나 마나이므로 여기서 한 번에 막는다.
 */
export function legalBody(key: LegalDocumentKey, locale: string): string {
  const { body } = LEGAL_DOCUMENTS[key];
  return body[locale as keyof typeof body] ?? body.en;
}
