import { apiDocsEnabled } from './app-setup';

/**
 * `/api/docs`는 인증 없이 열려 있으면 전체 엔드포인트·DTO·에러 코드가 그대로 드러난다.
 * 실사용자 가입이 열리는 시점에 닫기로 되어 있던 항목이라(docs/deployment.md), 기본값이
 * 되돌아가지 않도록 여기서 못박는다.
 */
describe('apiDocsEnabled', () => {
  it('프로덕션에서는 기본적으로 닫힌다', () => {
    expect(apiDocsEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('개발·테스트에서는 열린다 — 프론트가 스펙을 참고한다', () => {
    expect(apiDocsEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(apiDocsEnabled({ NODE_ENV: 'test' })).toBe(true);
    // NODE_ENV가 아예 없는 로컬 실행도 개발로 본다.
    expect(apiDocsEnabled({})).toBe(true);
  });

  it('ENABLE_API_DOCS=true면 프로덕션에서도 연다 — 의도적인 탈출구다', () => {
    expect(
      apiDocsEnabled({ NODE_ENV: 'production', ENABLE_API_DOCS: 'true' }),
    ).toBe(true);
  });

  it('ENABLE_API_DOCS가 정확히 "true"가 아니면 열지 않는다', () => {
    // '1'·'yes'·빈 문자열 같은 값이 우연히 들어가 열리는 일이 없어야 한다. 켜는 것은
    // 항상 의도적인 행위여야 하고, 실수로 켜진 상태는 알아채기 어렵다.
    for (const value of ['1', 'yes', 'TRUE', '', 'false']) {
      expect(
        apiDocsEnabled({ NODE_ENV: 'production', ENABLE_API_DOCS: value }),
      ).toBe(false);
    }
  });
});
