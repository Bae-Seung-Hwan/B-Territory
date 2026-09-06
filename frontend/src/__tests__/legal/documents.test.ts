import { i18n } from '@/i18n';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_KEYS, type LegalDocumentKey } from '@/legal';

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

  it('문의처가 세 문서 모두에 같은 주소로 적혀 있다', () => {
    // Apple 1.2가 요구하는 공개 연락처 — 문서마다 다르면 어디로 보내야 할지 알 수 없다.
    for (const key of LEGAL_DOCUMENT_KEYS) {
      for (const locale of locales) {
        expect(LEGAL_DOCUMENTS[key].body[locale]).toContain('B.territory123@gmail.com');
      }
    }
  });

  // 문서를 추가하면서 번역만 빠뜨리면 화면에 i18n-js의 "[missing ...]"이 그대로 노출된다.
  describe.each(locales)('%s 번역', (locale) => {
    const labelKey: Record<LegalDocumentKey, string> = {
      service: 'serviceTerms',
      privacy: 'privacyPolicy',
      location: 'locationTerms',
    };
    const titleKey: Record<LegalDocumentKey, string> = {
      service: 'serviceTermsTitle',
      privacy: 'privacyPolicyTitle',
      location: 'locationTermsTitle',
    };

    it.each(LEGAL_DOCUMENT_KEYS)('%s의 라벨과 제목이 모두 있다', (key) => {
      i18n.locale = locale;
      expect(i18n.t(`auth.terms.${labelKey[key]}`)).not.toContain('[missing');
      expect(i18n.t(`auth.terms.${titleKey[key]}`)).not.toContain('[missing');
    });
  });

  it('만 14세 확인 문구가 두 언어에 모두 있다', () => {
    for (const locale of locales) {
      i18n.locale = locale;
      expect(i18n.t('auth.terms.ageConfirm')).not.toContain('[missing');
    }
  });
});
