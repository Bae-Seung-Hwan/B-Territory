import { ko } from '@/i18n/locales/ko';
import { en } from '@/i18n/locales/en';
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_KEYS,
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
