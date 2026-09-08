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
 * 그 `LegalDocumentKey`는 `frontend/src/legal/index.ts`에 있다. 대조할 상대를 못 찾으면 위
 * 검사는 **통과가 아니라 실패**한다 — 조용히 건너뛰면 파일이 옮겨지거나 지워지는 순간 검사도
 * 함께 사라져, 그 검사가 없애려던 구멍이 그대로 되살아나기 때문이다.
 */
export enum ConsentDocument {
  SERVICE = 'service',
  PRIVACY = 'privacy',
  LOCATION = 'location',
  AGE_14_OVER = 'age14',
}

/**
 * 최소연령 정책의 결정 시점(docs/compliance.md 2.5에서 만 14세로 확정).
 * 기준 연령을 바꾸면 이 값을 올려 그때부터의 동의를 구분할 수 있게 한다.
 */
export const AGE_POLICY_VERSION = '2026-09-07';

/**
 * 클라이언트가 개정일을 보내는 항목과, 서버가 **받아줄 개정일 전부**.
 *
 * `current`는 지금 배포된 문서의 개정일이고, `superseded`는 지난 개정일이다. 둘 다 받는다 —
 * 앱 업데이트는 원자적이지 않아서, 현재 버전만 받으면 문서를 개정하는 순간 아직 업데이트하지
 * 않은 설치본 전체의 가입이 400이 된다. 지난 개정일은 실재했던 문서의 값이라 원장에 남아도
 * 거짓이 아니고, `version`이 남아 있으므로 재동의 대상으로 나중에 골라낼 수 있다.
 */
type ClientSourced = {
  readonly current: string;
  readonly superseded: readonly string[];
};

type ServerSourced = { readonly serverVersion: string };

function isServerSourced(
  source: ClientSourced | ServerSourced,
): source is ServerSourced {
  return 'serverVersion' in source;
}

/**
 * 항목별로 `version`을 **누가 공급하는지**, 그리고 클라이언트가 보내는 값 중 **무엇을 받아줄지**.
 *
 * - `ClientSourced`: 조항 전문이 있는 문서. 화면에 실제로 표시한 문서의 개정일을 클라이언트가 보낸다.
 * - `ServerSourced`: 조항 전문이 없는 항목. 클라이언트가 보낼 `version`이 존재하지 않으므로
 *   서버가 자기 상수로 채운다.
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
 *
 * ⚠️ **`current`의 원본은 프론트의 `LegalDocument.version`이고 여기 적힌 것은 사본이다.**
 * 조항 전문과 개정일이 같은 파일에 있어야 "본문을 고치면서 버전을 안 올리는" 실수를 막을 수
 * 있어 원본을 그쪽에 뒀다. 두 값이 어긋나는지는 `consent-document-contract.spec.ts`가
 * 대조하므로 한쪽만 고치면 CI가 막는다.
 *
 * **그래서 문서를 개정할 때는 백엔드를 먼저 배포한다.** 여기에 새 개정일을 `current`로 올리고
 * 기존 값을 `superseded`로 내린 뒤 프론트를 배포하면, 그 사이에는 구버전 설치본이 계속
 * 가입할 수 있어 중단이 없다. 순서를 뒤집으면 새 앱이 서버가 모르는 개정일을 보내 가입이
 * 막힌다(`CONSENT_VERSION_UNKNOWN`).
 */
const CONSENT_VERSION_SOURCE: Record<
  ConsentDocument,
  ClientSourced | ServerSourced
> = {
  [ConsentDocument.SERVICE]: { current: '2026-09-08', superseded: [] },
  [ConsentDocument.PRIVACY]: { current: '2026-09-08', superseded: [] },
  [ConsentDocument.LOCATION]: { current: '2026-09-08', superseded: [] },
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
    (doc) => !isServerSourced(CONSENT_VERSION_SOURCE[doc]),
  );

/**
 * 문서별 **현재** 개정일. 프론트 `LegalDocument.version`과 같아야 하는 값이며, 계약 테스트가
 * 대조하는 대상도 이것이다. 재동의 대상 판단(원장의 `version`과 비교)의 기준값이기도 하다.
 */
export const CURRENT_CONSENT_VERSIONS: Readonly<
  Partial<Record<ConsentDocument, string>>
> = Object.fromEntries(
  CLIENT_CONSENT_DOCUMENTS.map((document) => [
    document,
    (CONSENT_VERSION_SOURCE[document] as ClientSourced).current,
  ]),
);

/**
 * 문서별로 **받아주는** 개정일 전부(현재 + 지난 값). 여기 없는 값은 거절한다 —
 * 형식만 맞는 엉뚱한 날짜가 "동의했다"는 기록으로 영구히 남는 것을 막는다.
 */
export const ACCEPTED_CONSENT_VERSIONS: Readonly<
  Partial<Record<ConsentDocument, readonly string[]>>
> = Object.fromEntries(
  CLIENT_CONSENT_DOCUMENTS.map((document) => {
    const source = CONSENT_VERSION_SOURCE[document] as ClientSourced;
    return [document, [source.current, ...source.superseded]];
  }),
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
  return isServerSourced(source)
    ? [{ document, version: source.serverVersion }]
    : [];
});

/** 서버가 채우는 항목의 식별자만. 클라이언트가 이 항목을 보내면 중복이 되므로 막는 데 쓴다. */
export const SERVER_CONSENT_DOCUMENTS: readonly ConsentDocument[] =
  SERVER_CONSENT_ROWS.map((row) => row.document);

/**
 * `version`의 형식 — 문서 개정일(YYYY-MM-DD).
 *
 * DTO 단계에서 형식을 먼저 걸러 "undefined"·빈 문자열 같은 배선 사고가 값 대조까지 가지
 * 않게 한다. **형식이 맞는 엉뚱한 날짜는 여기서 걸러지지 않는다** — 값 자체는 허용 목록을
 * 아는 `buildConsentRows`가 `ACCEPTED_CONSENT_VERSIONS`와 대조해 거절한다
 * (`CONSENT_VERSION_UNKNOWN`).
 */
export const CONSENT_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
