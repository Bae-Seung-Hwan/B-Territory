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

/**
 * 서버 동의 원장(`user_consents`)에 남길 한 건. `document`는 백엔드 `ConsentDocument`와
 * **문자열이 같아야 한다** — append-only 원장의 varchar라 어긋난 채로 쌓이면 되돌릴 수 없다.
 * 그 대조를 사람 눈이 아니라 타입이 하도록, 여기서 `LegalDocumentKey`를 그대로 쓴다.
 */
export interface ConsentRecord {
  document: LegalDocumentKey;
  version: string;
}

/**
 * 동의 시점에 확정되는 값. 가입 API(`POST /api/auth/register`)의 `consents`/`ageConfirmed`가
 * 그대로 이 모양이다.
 *
 * 만 14세 확인만 배열이 아니라 별도 불리언인 이유는 대응하는 조항 전문이 없어 **보낼
 * `version`이 없기** 때문이다. 원장에는 `age14` 행으로 남되 그 버전은 서버가 채운다.
 */
export interface ConsentSnapshot {
  consents: ConsentRecord[];
  ageConfirmed: boolean;
}

/**
 * 체크박스 상태를 서버로 보낼 동의 기록으로 바꾼다. **하나라도 빠지면 `null`이다** —
 * 부분 동의로 가입을 시도해봐야 서버가 `CONSENT_INCOMPLETE`로 400을 주고, 그 400은
 * use-registration-flow.ts의 롤백 판정에 걸려 Firebase 계정 삭제까지 간다.
 *
 * 보낼 목록을 손으로 적지 않고 `LEGAL_DOCUMENT_KEYS`에서 파생시킨다 — 문서를 추가하고
 * 여기 배열에만 빠뜨리면, 화면에서는 동의를 받아놓고 서버에는 그 항목만 조용히 빠진
 * 요청이 나간다(그리고 서버가 필수 목록을 자기가 정하므로 400이 된다).
 *
 * `version`은 상수를 다시 읽는 게 아니라 **화면에 실제로 표시한 문서의 값**이다. 이 값이
 * 재동의 대상 판단의 기준이라, 표시한 것과 다른 값을 남기면 원장이 거짓이 된다.
 */
export function buildConsentSnapshot(
  agreed: Record<LegalDocumentKey, boolean>,
  ageConfirmed: boolean,
): ConsentSnapshot | null {
  if (!ageConfirmed) return null;
  if (!LEGAL_DOCUMENT_KEYS.every((key) => agreed[key])) return null;

  return {
    consents: LEGAL_DOCUMENT_KEYS.map((key) => ({
      document: key,
      version: LEGAL_DOCUMENTS[key].version,
    })),
    ageConfirmed: true,
  };
}
