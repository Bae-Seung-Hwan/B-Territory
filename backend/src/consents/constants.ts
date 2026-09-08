/**
 * 가입 시 동의를 받는 항목의 식별자.
 *
 * 값은 프론트엔드의 `LegalDocumentKey`와 **문자열이 일치해야 한다** — 한 번 쌓인 이력과의
 * 연결이 끊기므로 값 자체는 절대 바꾸지 않는다. 문서를 개정할 때 바뀌는 것은 이 키가 아니라
 * 함께 저장하는 `version`이다.
 *
 * 일치 여부는 `consent-document-contract.spec.ts`가 프론트 선언을 직접 읽어 대조한다. 그
 * 검사는 백엔드 유닛 테스트지만 `ci.yml`에 paths 필터가 없어 프론트 전용 PR에서도 돌기
 * 때문에, 어느 쪽을 먼저 바꾸든 짝을 맞추지 않으면 CI가 막는다. `document`는 append-only
 * 원장의 varchar라 어긋난 채로 쌓이면 되돌릴 수 없어, 사람 눈에 맡기지 않는다.
 *
 * ⚠️ 그 `LegalDocumentKey`는 `frontend/src/legal/index.ts`가 들여오는데 아직 develop에 없다 —
 * 미병합 브랜치 `feature/Ryu/terms-of-service`(PR #55)가 추가한다. 대조할 상대가 없으면 위
 * 검사는 **통과가 아니라 실패**하므로, 그 PR이 먼저 머지돼야 한다.
 */
export enum ConsentDocument {
  SERVICE = 'service',
  PRIVACY = 'privacy',
  LOCATION = 'location',
  AGE_14_OVER = 'age14',
}

/**
 * 항목별로 `version`을 **누가 공급하는지**.
 *
 * - `client`: 조항 전문이 있는 문서. 화면에 실제로 표시한 문서의 개정일을 클라이언트가 보낸다.
 * - `server`: 조항 전문이 없는 항목. 클라이언트가 보낼 `version`이 존재하지 않으므로 서버가
 *   자기 상수로 채운다.
 *
 * `age14`(만 14세 이상 확인)가 후자다. 본문을 읽고 하는 동의가 아니라 이용자의 진술이라
 * 프론트에 대응하는 `LegalDocument`가 없고, 따라서 보낼 개정일도 없다. 그런데도 기록은
 * 해야 한다 — 개인정보보호법상 14세 미만은 법정대리인 동의 없이 가입시킬 수 없어 확인
 * 사실의 입증 필요성이 나머지와 같다. 그래서 원장에는 같은 형태로 남기되, `version`만
 * 서버가 채운다. (이 구분을 두지 않고 네 항목 모두에게 클라이언트 `version`을 요구하면,
 * 프론트가 보낼 수 없는 값을 요구하는 셈이라 가입이 통째로 막힌다.)
 *
 * `Record`라 enum에 항목을 추가하면 여기 등록을 빠뜨릴 수 없다 — 손으로 적은 배열이면
 * 새 항목이 조용히 어느 쪽에도 속하지 않게 된다.
 */
/**
 * 최소연령 정책의 결정 시점(docs/compliance.md 2.5에서 만 14세로 확정).
 * 기준 연령을 바꾸면 이 값을 올려 그때부터의 동의를 구분할 수 있게 한다.
 */
export const AGE_POLICY_VERSION = '2026-09-07';

/** 클라이언트가 표시한 문서의 개정일을 그대로 받는 항목. */
const CLIENT_SOURCED = 'client' as const;

const CONSENT_VERSION_SOURCE: Record<
  ConsentDocument,
  typeof CLIENT_SOURCED | { readonly serverVersion: string }
> = {
  [ConsentDocument.SERVICE]: CLIENT_SOURCED,
  [ConsentDocument.PRIVACY]: CLIENT_SOURCED,
  [ConsentDocument.LOCATION]: CLIENT_SOURCED,
  // 서버가 채우는 항목은 **자기 버전을 여기 함께 적는다.** 카테고리 하나에 상수 하나를
  // 공유하면, 두 번째 서버 항목을 추가했을 때 그 행이 엉뚱하게 최소연령 정책의 개정일로
  // 적재된다 — 컴파일도 테스트도 통과하고, append-only라 사후에 고칠 수도 없다.
  [ConsentDocument.AGE_14_OVER]: { serverVersion: AGE_POLICY_VERSION },
};

const CONSENT_DOCUMENTS = Object.keys(
  CONSENT_VERSION_SOURCE,
) as ConsentDocument[];

/**
 * 클라이언트가 `consents`로 보내야 하는 문서. 하나라도 빠지거나 중복되면 가입을 받지 않는다.
 * 위 표에서 파생시키므로 새 문서를 추가하면 자동으로 필수가 된다.
 */
export const CLIENT_CONSENT_DOCUMENTS: readonly ConsentDocument[] =
  CONSENT_DOCUMENTS.filter(
    (doc) => CONSENT_VERSION_SOURCE[doc] === CLIENT_SOURCED,
  );

/**
 * 서버가 `version`을 채우는 항목과 그 버전. 현재는 만 14세 확인 하나뿐이다.
 * 항목별로 버전을 들고 있어, 새 항목을 추가하면 버전을 함께 적지 않고는 등록할 수 없다.
 */
export const SERVER_CONSENT_ROWS: readonly {
  document: ConsentDocument;
  version: string;
}[] = CONSENT_DOCUMENTS.flatMap((document) => {
  const source = CONSENT_VERSION_SOURCE[document];
  return source === CLIENT_SOURCED
    ? []
    : [{ document, version: source.serverVersion }];
});

/** 서버가 채우는 항목의 식별자만. 클라이언트가 이 항목을 보내면 중복이 되므로 막는 데 쓴다. */
export const SERVER_CONSENT_DOCUMENTS: readonly ConsentDocument[] =
  SERVER_CONSENT_ROWS.map((row) => row.document);

/**
 * `version`의 형식 — 문서 개정일(YYYY-MM-DD).
 *
 * 형식 검사만으로도 재동의 판단을 망가뜨리는 가장 흔한 사고("undefined", 빈 문자열 등이
 * 그대로 적재되는 것)를 막는다. 다만 **형식이 맞는 엉뚱한 날짜는 걸러지지 않는다** —
 * 서버가 문서별 현재 버전을 알아야 잡을 수 있고, 그건 문서 개정마다 백엔드 배포를 묶는
 * 선택이라 별도 결정으로 남겨 뒀다(docs/compliance.md 6장).
 */
export const CONSENT_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
