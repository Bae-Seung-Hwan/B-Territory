import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import {
  CLIENT_CONSENT_DOCUMENTS,
  CURRENT_CONSENT_VERSIONS,
  ConsentDocument,
} from './constants';

/**
 * 백엔드 `ConsentDocument`와 프론트엔드 `LegalDocumentKey`의 **문자열 일치**를 CI에서 강제한다.
 *
 * 두 값이 어긋난 채로 가입이 돌면 append-only 원장(`user_consents.document`)에 잘못된
 * 식별자가 영구히 쌓인다 — 사후에 고칠 수 없는 종류의 사고다. 그런데 저장소 어디에도 두
 * 심볼을 잇는 코드가 없어서, 예컨대 프론트가 `LegalDocumentKey`에 값을 하나 더 늘리면서
 * 백엔드 변경 없이 먼저 머지돼도(혹은 그 반대) tsc도 CI도 리뷰도 알아채지 못한다.
 * 여태 안전장치가 "머지할 때 눈으로 확인할 것"이라는 주석 하나뿐이었고, 이 파일이 그 자리를
 * 대신한다.
 *
 * **왜 백엔드 유닛 테스트인가.** `.github/workflows/ci.yml`에는 paths 필터가 없어(develop
 * 룰셋이 required status check로 요구하는 탓이다) 프론트 전용 PR에서도 이 job이 그대로 돈다.
 * 그래서 여기 두면 양쪽 방향의 변경을 다 잡는다 — 반대로 프론트 CI에만 두면 백엔드 enum만
 * 건드린 PR을 놓친다.
 *
 * **왜 소스를 읽어 파싱하는가.** 리뷰에서 제안된 "실제 API 응답과 대조"는 프론트 jest가
 * 백엔드 서버를 띄울 수 없어 성립하지 않고, `LegalDocumentKey`는 런타임 값이 아니라 타입이라
 * import로 읽을 수도 없다(런타임 값인 `LEGAL_DOCUMENT_KEYS`는 조항 전문 모듈들을 함께
 * 끌어와 백엔드 jest의 변환 범위 밖이다). 남는 방법이 선언 텍스트를 읽는 것뿐이다.
 *
 * 대신 파싱이 조금이라도 어긋나면 — 선언을 못 찾음, 둘 이상, 문자열 리터럴 유니온이 아님 —
 * **통과가 아니라 실패로 떨어뜨린다.** 못 찾았을 때 조용히 건너뛰면 파일이 옮겨지거나
 * 지워지는 순간 검사도 함께 사라져, 이 파일이 없애려던 구멍이 그대로 되살아난다.
 */

/** 프론트엔드 소스 루트. 이 파일은 `backend/src/consents/`에 있다. */
const FRONTEND_SRC = resolve(__dirname, '..', '..', '..', 'frontend', 'src');

/** `export type LegalDocumentKey = 'a' | 'b';` 의 우변을 뽑는다. 줄바꿈을 넘어도 잡힌다. */
const DECLARATION_PATTERN = /export\s+type\s+LegalDocumentKey\s*=\s*([^;]+);/g;

const STRING_LITERAL_PATTERN = /^'([^']*)'$/;

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // node_modules와 숨김 디렉터리는 소스가 아니다.
      if (entry.name === 'node_modules' || entry.name.startsWith('.'))
        return [];
      return tsFilesUnder(full);
    }
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * 프론트엔드가 선언한 동의 문서 키를 읽어 온다. 확인할 수 없는 상태는 전부 예외로 만든다 —
 * 메시지에 다음에 할 일을 적어 둔다.
 */
function readFrontendDocumentKeys(): string[] {
  if (!existsSync(FRONTEND_SRC)) {
    throw new Error(
      `프론트엔드 소스를 찾지 못했다(${FRONTEND_SRC}). ` +
        '이 검사는 저장소 전체가 체크아웃된 상태를 전제한다.',
    );
  }

  const hits = tsFilesUnder(FRONTEND_SRC).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(DECLARATION_PATTERN)].map((match) => ({
      file: relative(FRONTEND_SRC, file),
      union: match[1],
    }));
  });

  if (hits.length === 0) {
    throw new Error(
      'frontend/src 어디에도 `LegalDocumentKey` 선언이 없다. ' +
        '약관 문서 모듈(frontend/src/legal/)이 아직 develop에 없다면 그 PR을 먼저 머지할 것 — ' +
        '이 검사 없이 두 식별자가 어긋나면 append-only 원장에 되돌릴 수 없는 값이 쌓인다. ' +
        '선언을 다른 이름으로 옮겼다면 이 테스트의 DECLARATION_PATTERN을 함께 고칠 것.',
    );
  }
  if (hits.length > 1) {
    throw new Error(
      `\`LegalDocumentKey\` 선언이 ${hits.length}곳에 있다(${hits
        .map((hit) => hit.file)
        .join(', ')}). 어느 쪽이 진짜인지 알 수 없으므로 대조하지 않는다.`,
    );
  }

  const members = hits[0].union.split('|').map((member) => member.trim());
  const notLiteral = members.filter(
    (member) => !STRING_LITERAL_PATTERN.test(member),
  );
  if (notLiteral.length > 0) {
    throw new Error(
      `\`LegalDocumentKey\`가 문자열 리터럴 유니온이 아니다(${notLiteral.join(
        ', ',
      )}). 값을 대조할 수 없으므로 실패시킨다 — 선언 형태를 바꿨다면 이 테스트도 함께 고칠 것.`,
    );
  }

  return members.map((member) => member.slice(1, -1));
}

/** `LEGAL_DOCUMENTS: Record<…> = { service: termsOfService, … }`의 본문을 뽑는다. */
const DOCUMENT_MAP_PATTERN =
  /LEGAL_DOCUMENTS\s*:\s*Record<[^=]*>\s*=\s*\{([^}]*)\}/;
/** 그 본문의 `키: 식별자,` 한 줄. */
const DOCUMENT_MAP_ENTRY_PATTERN = /(\w+)\s*:\s*(\w+)\s*,/g;

/**
 * 프론트 각 문서의 개정일(`LegalDocument.version`)을 문서 키별로 읽어 온다.
 *
 * 개정일의 **원본은 프론트다** — 조항 전문과 같은 파일에 둬야 "본문을 고치면서 버전을 안
 * 올리는" 실수를 막을 수 있어서다. 백엔드의 `CURRENT_CONSENT_VERSIONS`는 그 사본이고, 서버가
 * 값을 대조하려면(형식만 보던 것을 값까지 보게 하려면) 사본을 들 수밖에 없다. 둘이 어긋나면
 * 갱신하지 않은 쪽 때문에 멀쩡한 가입이 `CONSENT_VERSION_UNKNOWN`으로 막히거나, 반대로
 * 개정 전 개정일이 최신인 척 원장에 쌓인다. 그 어긋남을 여기서 잡는다.
 *
 * 문서 키 → 식별자 → 그 식별자의 선언 순으로 따라간다. 어느 단계든 못 따라가면 실패다.
 */
function readFrontendDocumentVersions(): Record<string, string> {
  if (!existsSync(FRONTEND_SRC)) {
    throw new Error(
      `프론트엔드 소스를 찾지 못했다(${FRONTEND_SRC}). ` +
        '이 검사는 저장소 전체가 체크아웃된 상태를 전제한다.',
    );
  }

  const sources = tsFilesUnder(FRONTEND_SRC).map((file) => ({
    file,
    text: readFileSync(file, 'utf8'),
  }));

  const withMap = sources.filter((source) =>
    DOCUMENT_MAP_PATTERN.test(source.text),
  );
  if (withMap.length !== 1) {
    throw new Error(
      `\`LEGAL_DOCUMENTS\` 선언을 ${withMap.length}곳에서 찾았다(1곳이어야 한다). ` +
        '문서 키와 개정일을 잇는 표라 이걸 못 찾으면 버전을 대조할 수 없다.',
    );
  }

  const body = DOCUMENT_MAP_PATTERN.exec(withMap[0].text)?.[1] ?? '';
  const entries = [...body.matchAll(DOCUMENT_MAP_ENTRY_PATTERN)];
  if (entries.length === 0) {
    throw new Error(
      '`LEGAL_DOCUMENTS`에서 `키: 식별자` 항목을 하나도 읽지 못했다. ' +
        '표의 형태가 바뀌었다면 이 테스트의 DOCUMENT_MAP_ENTRY_PATTERN도 함께 고칠 것.',
    );
  }

  return Object.fromEntries(
    entries.map(([, key, identifier]) => {
      // 식별자의 선언을 찾아 그 객체 리터럴의 첫 version을 읽는다. 본문(body)에도 날짜
      // 문자열이 흔하지만 version 필드보다 뒤에 오므로 첫 매치가 정답이다.
      const declaration = new RegExp(
        `export\\s+const\\s+${identifier}\\s*:\\s*LegalDocument\\s*=\\s*\\{`,
      );
      const source = sources.find((candidate) =>
        declaration.test(candidate.text),
      );
      if (!source) {
        throw new Error(
          `\`LEGAL_DOCUMENTS.${key}\`가 가리키는 \`${identifier}\`의 선언을 찾지 못했다.`,
        );
      }

      const after = source.text.slice(
        (declaration.exec(source.text)?.index ?? 0) + 1,
      );
      const version = /version\s*:\s*'([^']*)'/.exec(after)?.[1];
      if (!version) {
        throw new Error(
          `\`${identifier}\`에 \`version\`이 없다(${relative(FRONTEND_SRC, source.file)}). ` +
            '개정일 없이는 재동의 대상을 고를 수 없으므로 실패시킨다.',
        );
      }
      return [key, version];
    }),
  );
}

describe('동의 문서 식별자 계약 (백엔드 ↔ 프론트엔드)', () => {
  it('프론트엔드의 LegalDocumentKey 선언을 하나만 찾아 파싱한다', () => {
    expect(() => readFrontendDocumentKeys()).not.toThrow();
  });

  it('CLIENT_CONSENT_DOCUMENTS와 문자열이 정확히 일치한다', () => {
    // 정렬해서 비교한다 — 표시 순서는 프론트가 정하는 값이라 이 검사의 관심사가 아니다.
    expect([...readFrontendDocumentKeys()].sort()).toEqual(
      [...CLIENT_CONSENT_DOCUMENTS].sort(),
    );
  });

  it('서버가 version을 채우는 age14는 프론트 문서 키에 없다', () => {
    // 위 일치 검사에 이미 포함되지만, 이 어긋남만은 실패 메시지가 명확해야 한다 —
    // 프론트에 `age14`가 생기면 클라이언트가 보낼 수 없는 version을 요구하는 셈이라
    // 두 브랜치가 머지되는 순간 가입이 통째로 400이 된다(실제로 한 번 그럴 뻔했다).
    expect(readFrontendDocumentKeys()).not.toContain(
      ConsentDocument.AGE_14_OVER,
    );
  });

  it('CURRENT_CONSENT_VERSIONS가 프론트 문서의 개정일과 같다', () => {
    // 서버가 `version` 값을 대조하게 되면서 백엔드도 개정일을 들게 됐다(사본이다).
    // 한쪽만 올리면 멀쩡한 가입이 CONSENT_VERSION_UNKNOWN으로 막히거나, 개정 전 날짜가
    // 최신인 척 원장에 쌓인다 — 둘 다 배포 전에 잡아야 한다.
    expect(readFrontendDocumentVersions()).toEqual(CURRENT_CONSENT_VERSIONS);
  });
});
