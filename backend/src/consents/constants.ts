/**
 * 가입 시 동의를 받는 항목의 식별자.
 *
 * 값은 프론트엔드 `frontend/src/legal/index.ts`의 `LegalDocumentKey`와 **문자열이 일치해야
 * 한다** — 한 번 쌓인 이력과의 연결이 끊기므로 값 자체는 절대 바꾸지 않는다. 문서를 개정할
 * 때 바뀌는 것은 이 키가 아니라 함께 저장하는 `version`이다.
 *
 * AGE_14_OVER만 대응하는 조항 전문이 없다. 만 14세 이상 확인은 본문을 읽고 하는 동의가
 * 아니라 이용자의 진술이지만, 기록해야 하는 이유(개인정보보호법상 14세 미만은 법정대리인
 * 동의 없이 가입시킬 수 없다)와 입증 필요성이 나머지와 같아 같은 원장에 같은 형태로 남긴다.
 * 이 항목의 `version`은 최소연령 정책의 결정 시점을 가리킨다(docs/compliance.md 2.5).
 */
export enum ConsentDocument {
  SERVICE = 'service',
  PRIVACY = 'privacy',
  LOCATION = 'location',
  AGE_14_OVER = 'age14',
}

/**
 * 가입에 반드시 필요한 동의 항목. 하나라도 빠지면 가입 자체를 받지 않는다.
 *
 * `Object.values(ConsentDocument)`에서 **파생**시킨다. 손으로 적은 배열이면 새 항목을 enum에만
 * 추가하고 여기 빠뜨렸을 때 tsc가 깨끗한 채로 그 항목만 조용히 선택 사항이 된다 — 동의를 받지
 * 않은 문서가 소리 없이 생기는 것이 애초에 이 기능이 막으려는 실패다. (선택 동의 항목이
 * 생기면 그때 필수/선택 구분을 enum이 아니라 별도 표로 표현할 것.)
 */
export const REQUIRED_CONSENT_DOCUMENTS: readonly ConsentDocument[] =
  Object.values(ConsentDocument);
