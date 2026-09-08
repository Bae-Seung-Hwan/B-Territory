import { ko } from '@/i18n/locales/ko';
import { en } from '@/i18n/locales/en';
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_KEYS,
  buildConsentSnapshot,
  legalBody,
  type LegalDocumentKey,
} from '@/legal';

/**
 * 이 문서들은 가입 시 "(필수) 동의"를 받는 대상이라, 내용이 비어 있거나 예시 텍스트로
 * 되돌아가면 동의 자체가 무의미해진다. 예전에는 본문이 실제로 농담 플레이스홀더였고
 * ("구름을 세는 행위", "화요일에만 존재하는 고양이") 그 상태로 필수 동의를 받고 있었다.
 */
describe('legal documents', () => {
  const locales = ['ko', 'en'] as const;

  // 이 단어들이 다시 등장하면 누군가 본문을 예시 텍스트로 되돌린 것이다.
  const PLACEHOLDER_MARKERS = [
    '구름을 세는',
    '화요일에만',
    '여섯 번째 손가락',
    '무지개가 뜰 때까지',
    '법적 효력이 없는',
    'counting clouds',
    'only exists on Tuesdays',
    'sixth finger',
    'until a rainbow appears',
    'no real legal effect',
    'placeholder',
  ];

  it.each(LEGAL_DOCUMENT_KEYS)('%s 문서가 등록돼 있다', (key) => {
    expect(LEGAL_DOCUMENTS[key]).toBeDefined();
  });

  it.each(LEGAL_DOCUMENT_KEYS)('%s의 version이 개정일(YYYY-MM-DD) 형식이다', (key) => {
    // 동의 이력에 그대로 남는 값이라 형식이 흔들리면 안 된다.
    expect(LEGAL_DOCUMENTS[key].version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /**
   * 부칙의 시행일은 `version`과 같은 날이어야 한다.
   *
   * 둘은 같은 사실("이 문서가 언제부터의 것인가")을 두 군데에 적어둔 것인데, `version`은
   * 상수 한 줄이고 시행일은 본문 맨 끝이라 조항을 고치면서 한쪽만 올리기 쉽다. 실제로
   * 2차 리뷰 반영에서 `version`만 2026-09-08로 올라가고 부칙은 9월 7일로 남았었다.
   * 어긋나면 **이용자가 읽는 시행일과 동의 원장(`user_consents.version`)에 남는 값이
   * 달라져**, 나중에 "어느 문서에 동의했는가"를 원장으로 되짚을 수 없게 된다.
   */
  it.each(LEGAL_DOCUMENT_KEYS)('%s의 부칙 시행일이 version과 같은 날이다', (key) => {
    const [year, month, day] = LEGAL_DOCUMENTS[key].version.split('-').map(Number);
    const MONTHS_EN = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];

    expect(LEGAL_DOCUMENTS[key].body.ko).toContain(`${year}년 ${month}월 ${day}일`);
    expect(LEGAL_DOCUMENTS[key].body.en).toContain(`${day} ${MONTHS_EN[month - 1]} ${year}`);
  });

  describe.each(locales)('%s 본문', (locale) => {
    it.each(LEGAL_DOCUMENT_KEYS)('%s에 실제 조항이 들어 있다', (key) => {
      const body = LEGAL_DOCUMENTS[key].body[locale];
      // 조항 몇 개짜리 문서라 이 길이를 밑돌면 내용이 빠진 것이다.
      expect(body.length).toBeGreaterThan(1000);
    });

    it.each(LEGAL_DOCUMENT_KEYS)('%s에 예시 텍스트가 남아 있지 않다', (key) => {
      const body = LEGAL_DOCUMENTS[key].body[locale].toLowerCase();
      for (const marker of PLACEHOLDER_MARKERS) {
        expect(body).not.toContain(marker.toLowerCase());
      }
    });
  });

  // 위치정보법상 개인정보처리방침으로 갈음할 수 없는 별도 문서다(docs/compliance.md 2.3).
  // 항목에서 빠지면 위치 데이터를 동의 없이 이용하는 상태가 된다.
  /**
   * 앱은 `PROVIDER_GOOGLE`(react-native-maps 네이티브)로 지도를 그린다. 카카오맵 WebView는
   * 이미 제거됐는데(KakaoMapView.tsx 없음, 카카오 SDK 의존성 없음) 조항에는 "카카오맵을
   * 사용하며 카카오에 위치를 전달하지 않는다"가 남아 있었다 — 쓰지도 않는 사업자를 명시하고
   * 실제로 임베드된 사업자는 어디에도 적지 않은, 양방향으로 틀린 상태였다.
   */
  it.each(LEGAL_DOCUMENT_KEYS)('%s가 쓰지 않는 지도 사업자를 명시하지 않는다', (key) => {
    for (const locale of locales) {
      const body = LEGAL_DOCUMENTS[key].body[locale].toLowerCase();
      expect(body).not.toContain('카카오');
      expect(body).not.toContain('kakao');
    }
  });

  it('지도 사업자를 명시한 문서는 실제로 쓰는 Google Maps를 가리킨다', () => {
    // 지도 언급이 있는 문서(개인정보처리방침 제6조·위치기반서비스 약관 제6조)만 검사한다.
    for (const key of LEGAL_DOCUMENT_KEYS) {
      for (const locale of locales) {
        const body = LEGAL_DOCUMENTS[key].body[locale];
        const mentionsMap = /지도 화면|map view/i.test(body);
        if (mentionsMap) expect(body).toContain('Google Maps SDK');
      }
    }
  });

  /**
   * 좌표는 실제로 Redis GEO(`geo:users`)에 남고, 결투 신청 거리 검증과 아군 보너스 판정에서
   * **나중에 다시 읽힌다**(나중에 읽는다는 것 자체가 보관의 증거다). 그런데 조항은 "즉시
   * 이용한 후 저장하지 않습니다"라고 적고 있었다 — 위치정보법 맥락에서 개인위치정보의 보유
   * 여부는 가장 먼저 확인되는 지점이라, 표현 다듬기가 아니라 사실관계가 틀린 것이었다.
   */
  it.each(LEGAL_DOCUMENT_KEYS)('%s가 좌표를 보관하지 않는다고 주장하지 않는다', (key) => {
    const FALSE_CLAIMS = [
      '좌표 자체는 저장하지 않',
      '즉시 이용한 후 저장하지 않',
      '즉시 사용되고 저장되지 않',
      'coordinates themselves are not stored',
      'are used immediately for the purposes in article 3 and are not stored',
      'coordinates are used for their purpose and not stored',
    ];
    for (const locale of locales) {
      const body = LEGAL_DOCUMENTS[key].body[locale].toLowerCase();
      for (const claim of FALSE_CLAIMS) {
        expect(body).not.toContain(claim.toLowerCase());
      }
    }
  });

  it('위치 조항이 실제 보유 방식(최신 1건·자동 삭제)을 밝힌다', () => {
    // 이 두 문서가 같은 사실을 서술하므로 한쪽만 고치면 서로 어긋난다.
    for (const locale of locales) {
      expect(LEGAL_DOCUMENTS.location.body[locale]).toMatch(/최신 1건|most-recent entry/);
      expect(LEGAL_DOCUMENTS.privacy.body[locale]).toMatch(/최신 1건|most-recent entry/);
      // 유령 좌표 정리 상한(GEO_STALE_TTL 10분 + GEO_PRUNE_INTERVAL_MS 5분).
      expect(LEGAL_DOCUMENTS.location.body[locale]).toMatch(/15분|15 minutes/);
      expect(LEGAL_DOCUMENTS.privacy.body[locale]).toMatch(/15분|15 minutes/);
    }
  });

  /**
   * 미션 방문 확인은 좌표에서 파생됐지만 좌표와 **수명이 다르다** —
   * `mission:visit:*`는 VISIT_WINDOW_SECONDS(24시간) TTL이라 접속을 끊어도 남는 반면,
   * 좌표는 handleDisconnect에서 즉시 사라진다. 두 문서가 좌표의 "최신 1건·15분"만
   * 서술하던 동안 이 기록은 어디에도 고지되지 않았다.
   */
  it('위치 조항이 24시간 방문 확인 기록을 밝힌다', () => {
    for (const locale of locales) {
      expect(LEGAL_DOCUMENTS.location.body[locale]).toMatch(/24시간|24 hours/);
      expect(LEGAL_DOCUMENTS.privacy.body[locale]).toMatch(/24시간|24 hours/);
    }
  });

  /**
   * 탈퇴 시 동의 이력을 별도 보관소로 옮겨 6개월 보관한다는 조항. 보유기간이 빠지면
   * 개인정보처리방침으로 성립하지 않으므로 기간까지 함께 확인한다. 이용약관 제11조도
   * 같은 사실을 서술하므로 한쪽만 남으면 두 문서가 어긋난다.
   */
  it('탈퇴 시 동의 이력 백업과 그 보유기간이 두 문서에 있다', () => {
    for (const locale of locales) {
      expect(LEGAL_DOCUMENTS.privacy.body[locale]).toMatch(/6개월|six months/);
      expect(LEGAL_DOCUMENTS.privacy.body[locale]).toMatch(/동의 이력|consent|terms agreed to/i);
      expect(LEGAL_DOCUMENTS.service.body[locale]).toMatch(/6개월|six months/);
    }
  });

  /**
   * 본문은 login.tsx가 `<Text>`에 그대로 넣어 렌더링한다 — 마크다운 렌더러가 없다.
   * 예전 제6조의 `| 수탁자 | 위탁 업무 |` 표기는 이용자에게 파이프 문자 그대로 보였다.
   */
  it.each(LEGAL_DOCUMENT_KEYS)('%s 본문에 마크다운 표 문법이 없다', (key) => {
    for (const locale of locales) {
      for (const line of LEGAL_DOCUMENTS[key].body[locale].split('\n')) {
        expect(line.trim().startsWith('|')).toBe(false);
      }
    }
  });

  it('위치기반서비스 이용약관이 동의 항목에 포함된다', () => {
    expect(LEGAL_DOCUMENT_KEYS).toContain<LegalDocumentKey>('location');
  });

  it('동의 항목 목록이 등록된 문서를 하나도 빠뜨리지 않는다', () => {
    // LEGAL_DOCUMENT_KEYS를 손으로 적은 리터럴 배열로 되돌리면(과거 형태) 타입이
    // readonly LegalDocumentKey[]라 부분집합도 통과해, 새 문서의 동의 항목만 조용히
    // 사라진다. 파생 구조가 유지되는지 여기서 못 박는다.
    expect([...LEGAL_DOCUMENT_KEYS].sort()).toEqual(Object.keys(LEGAL_DOCUMENTS).sort());
  });

  it('문의처가 세 문서 모두에 같은 주소로 적혀 있다', () => {
    // Apple 1.2가 요구하는 공개 연락처 — 문서마다 다르면 어디로 보내야 할지 알 수 없다.
    for (const key of LEGAL_DOCUMENT_KEYS) {
      for (const locale of locales) {
        expect(LEGAL_DOCUMENTS[key].body[locale]).toContain('B.territory123@gmail.com');
      }
    }
  });

  /**
   * 문서를 추가하면서 번역만 빠뜨리면 화면에 라벨이 비거나 영어가 섞여 나간다.
   *
   * **`i18n.t()`로 검사하지 않는다.** `enableFallback = true`라 `ko`에만 없는 키는
   * `[missing …]`이 아니라 영어로 폴백되므로, `t()` 기반 단언은 "한국어만 빠진" 경우를
   * 통째로 놓친다(두 언어 모두에서 빠져야만 잡힌다). 그래서 locale 사전 객체를 직접 본다.
   */
  const catalogs: Record<(typeof locales)[number], Record<string, unknown>> = {
    ko: ko.auth.terms,
    en: en.auth.terms,
  };

  describe.each(locales)('%s 번역', (locale) => {
    it.each(LEGAL_DOCUMENT_KEYS)('%s의 라벨과 제목이 모두 있다', (key) => {
      // 화면(login.tsx)이 실제로 쓰는 매핑을 그대로 읽는다 — 예전엔 이 테스트가 같은 표를
      // 복사해 들고 있어서, 화면 쪽 매핑이 틀리거나 항목이 빠져도 테스트는 통과했다.
      const { labelKey, titleKey } = LEGAL_DOCUMENTS[key];
      expect(typeof catalogs[locale][labelKey]).toBe('string');
      expect(typeof catalogs[locale][titleKey]).toBe('string');
    });
  });

  it('만 14세 확인 문구가 두 언어에 모두 있다', () => {
    for (const locale of locales) {
      expect(typeof catalogs[locale].ageConfirm).toBe('string');
    }
  });

  describe('legalBody의 locale 폴백', () => {
    it.each(LEGAL_DOCUMENT_KEYS)('%s: 지원 locale은 그 언어의 본문을 준다', (key) => {
      expect(legalBody(key, 'ko')).toBe(LEGAL_DOCUMENTS[key].body.ko);
      expect(legalBody(key, 'en')).toBe(LEGAL_DOCUMENTS[key].body.en);
    });

    // useTranslation()의 locale은 unchecked cast라 'ko'|'en'을 벗어날 수 있다. 그때
    // body[locale]을 직접 인덱싱하면 undefined가 되어, 조항 전문이 빈 화면인 채로
    // "(필수) 동의"를 요구하게 된다 — 본문이 안 보이는 동의는 받으나 마나다.
    it.each(LEGAL_DOCUMENT_KEYS)('%s: 지원하지 않는 locale이면 빈 화면 대신 en으로 떨어진다', (key) => {
      const body = legalBody(key, 'ja');
      expect(body).toBe(LEGAL_DOCUMENTS[key].body.en);
      expect(body.length).toBeGreaterThan(1000);
    });
  });

  it('전체 동의 라벨이 두 언어에 모두 있다', () => {
    // 이 토글은 연령 확인(사실 주장)까지 함께 켜므로 라벨이 그 범위를 밝혀야 한다.
    for (const locale of locales) {
      expect(typeof catalogs[locale].agreeAll).toBe('string');
    }
  });
});

/**
 * 서버로 보낼 동의 페이로드를 만드는 부분. `LEGAL_DOCUMENT_KEYS`에서 파생시키므로,
 * 문서를 추가하고 이 함수를 고치지 않아도 새 항목이 자동으로 포함된다 — 손으로 적은
 * 배열이었다면 화면에서는 동의를 받고 서버에는 그 항목만 빠진 요청이 나갔을 것이다.
 */
describe('buildConsentSnapshot', () => {
  const allAgreed = Object.fromEntries(LEGAL_DOCUMENT_KEYS.map((key) => [key, true])) as Record<
    LegalDocumentKey,
    boolean
  >;

  it('모든 문서와 연령 확인이 채워지면 문서 목록 그대로 만든다', () => {
    expect(buildConsentSnapshot(allAgreed, true)).toEqual({
      consents: LEGAL_DOCUMENT_KEYS.map((key) => ({
        document: key,
        version: LEGAL_DOCUMENTS[key].version,
      })),
      ageConfirmed: true,
    });
  });

  it('연령 확인이 빠지면 null이다', () => {
    expect(buildConsentSnapshot(allAgreed, false)).toBeNull();
  });

  it.each(LEGAL_DOCUMENT_KEYS)('%s 동의가 빠지면 null이다', (missing) => {
    expect(buildConsentSnapshot({ ...allAgreed, [missing]: false }, true)).toBeNull();
  });

  /**
   * `document`는 append-only 원장(backend `user_consents`)의 varchar라, 백엔드
   * `ConsentDocument`와 어긋난 채로 쌓이면 되돌릴 수 없다. 두 저장소를 잇는 자동 검증은
   * backend `consent-document-contract.spec.ts`가 맡고 있으므로(`src/consents/constants.ts`
   * 주석 참고), 이쪽에서도 그 계약이 기대하는 값을 고정해 둔다.
   */
  it('document 값이 백엔드 ConsentDocument와 같은 문자열이다', () => {
    const snapshot = buildConsentSnapshot(allAgreed, true);
    expect(snapshot?.consents.map((item) => item.document)).toEqual([
      'service',
      'privacy',
      'location',
    ]);
  });
});
