/**
 * 법적 문서 정적 페이지 생성기 — 스토어 심사에 필요한 공개 URL을 만든다.
 *
 * Google Play·원스토어 모두 개인정보처리방침 URL과 계정 삭제 요청 URL을 **앱 내 텍스트와
 * 별개로** 요구한다(docs/compliance.md 3장). 그 페이지를 손으로 다시 쓰면 앱 안의 조항과
 * 웹의 조항이 갈라지는데, 동의를 받은 문서와 공개된 문서가 다른 상태는 그 자체로 문제다.
 * 그래서 본문을 `frontend/src/legal/`에서 **읽어서** 생성한다 — 조항을 고치면 웹도 함께
 * 바뀌고, 개정일(`version`)도 같은 값이 실린다.
 *
 * 실행: `node scripts/build-legal-pages.mjs` (출력: `web/`)
 *
 * 법적 문서 모듈은 React Native에 의존하지 않는 순수 데이터라, 프론트엔드의 로컬 typescript로
 * 그 디렉터리만 따로 컴파일해 읽을 수 있다. 이 전제가 깨지면(legal/에 RN import가 생기면)
 * 아래 컴파일이 실패하므로 조용히 어긋나지는 않는다.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = join(ROOT, 'frontend');
const BUILD_DIR = join(ROOT, '.legal-build');
const OUT_DIR = join(ROOT, 'web');

/** 화면 라벨은 조항이 아니라 i18n에 있다(legal/은 본문과 version만 든다). */
const TITLES = {
  ko: {
    service: '이용약관',
    privacy: '개인정보처리방침',
    location: '위치기반서비스 이용약관',
  },
  en: {
    service: 'Terms of Service',
    privacy: 'Privacy Policy',
    location: 'Location-Based Services Terms',
  },
};

const APP_NAME = 'B-territory';

/** 생성하는 언어. TITLES의 키와 같아야 한다. */
const LANGS = ['ko', 'en'];

/**
 * 문서 키 → 파일 이름(확장자 앞까지). 스토어에 등록한 URL이 여기서 나오므로 한 번 정한
 * 이름은 바꾸지 않는다 — 바꾸면 이미 등록된 주소가 404가 된다.
 */
const FILE_FOR = {
  service: 'terms',
  privacy: 'privacy',
  location: 'location-terms',
};

/**
 * 조항 본문은 `frontend/src/legal/`에서 오지만, 파일 이름과 제목은 이 파일이 들고 있다.
 * 네 번째 문서가 LEGAL_DOCUMENTS에 추가되고 이 두 표에 반영되지 않으면 `TITLES[lang][key]`가
 * undefined인 채로 escapeHtml까지 내려가 정체를 알 수 없는 TypeError로 죽는다. 무엇을 어디에
 * 추가해야 하는지 말하고 멈춘다.
 */
function assertDocumentsCovered() {
  for (const key of Object.keys(LEGAL_DOCUMENTS)) {
    if (!FILE_FOR[key]) {
      throw new Error(
        `문서 '${key}'의 파일 이름이 없다 — 이 파일의 FILE_FOR에 추가할 것.`,
      );
    }
    for (const lang of LANGS) {
      if (!TITLES[lang]?.[key]) {
        throw new Error(
          `문서 '${key}'의 ${lang} 제목이 없다 — 이 파일의 TITLES에 추가할 것.`,
        );
      }
    }
  }
}

function loadSources() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  // 프론트엔드의 로컬 typescript를 node로 직접 실행한다 — npx는 셸 래퍼(.cmd)라
  // 플랫폼마다 spawn 방식이 달라진다.
  // rootDir을 src로 잡아 출력이 `<BUILD_DIR>/legal/index.js`로 떨어지게 한다.
  execFileSync(
    process.execPath,
    [
      join(FRONTEND, 'node_modules', 'typescript', 'bin', 'tsc'),
      'src/legal/index.ts',
      // 접수 주소는 이미 앱이 들고 있는 값이다(i18n 사전과 갈라지지 않게 모아 둔 상수).
      // 여기서 다시 적으면 세 번째 사본이 되고, 주소를 바꿔도 이 페이지만 옛 값으로 남는다.
      'src/constants/contact.ts',
      '--outDir',
      BUILD_DIR,
      '--rootDir',
      'src',
      '--module',
      'commonjs',
      '--target',
      'es2020',
      '--skipLibCheck',
      // 파일을 직접 지정하면 tsconfig.json이 무시되는데, TS 5.9부터는 그 상황을 에러로
      // 알린다(TS5112). 여기서는 legal/만 떼어 컴파일하는 것이 의도이므로 명시적으로 끈다.
      '--ignoreConfig',
    ],
    { cwd: FRONTEND, stdio: 'inherit' },
  );
  const require = createRequire(import.meta.url);
  return {
    ...require(join(BUILD_DIR, 'legal', 'index.js')),
    ...require(join(BUILD_DIR, 'constants', 'contact.js')),
  };
}

/** 조항 본문·개정일과 접수 주소. 아래 상수들이 쓰므로 모듈 로드 시점에 한 번 읽는다. */
const { LEGAL_DOCUMENTS, legalBody, CONTACT_EMAIL: CONTACT } = loadSources();

const escapeHtml = (text) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c],
  );

/**
 * 조항 전문은 줄바꿈과 **들여쓰기**로 구조를 표현한 평문이다. 빈 줄을 문단 경계로 삼되,
 * 문단 안은 손대지 않고 CSS `white-space: pre-wrap`으로 원문 그대로 보여준다.
 * `<br>`로 바꾸면 줄은 살아도 앞 공백이 접혀 하위 항목의 들여쓰기가 사라진다 — 앱에서 보이는
 * 모양과 웹이 달라지고, 조문 번호 아래 딸린 항목들이 같은 층위로 읽힌다.
 */
const renderBody = (body) =>
  body
    .trim()
    .split(/\n{2,}/)
    .map((para) => `<p class="doc">${escapeHtml(para)}</p>`)
    .join('\n');

const STYLE = `
:root { color-scheme: light dark; --fg: #1a1a1a; --muted: #666; --bg: #fff; --line: #e2e2e2; --accent: #208AEF; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #e8e8e8; --muted: #a0a0a0; --bg: #16181c; --line: #33363c; --accent: #6fb4f5; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.75 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif;
  -webkit-text-size-adjust: 100%; }
main { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }
h1 { font-size: 1.6rem; line-height: 1.35; margin: 0 0 .35rem; }
.meta { color: var(--muted); font-size: .875rem; margin: 0 0 2rem; }
p { margin: 0 0 1.15rem; overflow-wrap: anywhere; }
/* 조항 본문에만 건다 — 안내 문단은 소스에서 손으로 줄바꿈돼 있어, 전역으로 걸면 그 줄바꿈이
   그대로 화면에 드러난다. */
p.doc { white-space: pre-wrap; }
h2 { font-size: 1.15rem; margin: 2.25rem 0 .75rem; }
a { color: var(--accent); }
nav { display: flex; flex-wrap: wrap; gap: .75rem 1.25rem; padding-bottom: 1.25rem;
  margin-bottom: 2rem; border-bottom: 1px solid var(--line); font-size: .9rem; }
ul { padding-left: 1.25rem; }
li { margin-bottom: .5rem; }
footer { margin-top: 3.5rem; padding-top: 1.25rem; border-top: 1px solid var(--line);
  color: var(--muted); font-size: .875rem; }
`;

function page({ lang, title, meta, nav, content }) {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} · ${APP_NAME}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<nav>${nav}</nav>
<h1>${escapeHtml(title)}</h1>
${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ''}
${content}
<footer>${APP_NAME} · ${lang === 'en' ? 'Contact' : '문의'} <a href="mailto:${CONTACT}">${CONTACT}</a></footer>
</main>
</body>
</html>
`;
}

/**
 * `current`는 지금 보고 있는 페이지의 이름이다. 언어 전환이 **읽던 문서를 유지**하려면
 * 필요하다 — 목차로 고정하면 영문 방침을 읽던 사람이 한국어를 눌렀을 때 읽던 위치를 잃는다.
 */
const navFor = (lang, current) => {
  const suffix = lang === 'en' ? '.en.html' : '.html';
  const other = lang === 'en' ? '한국어' : 'English';
  const otherHref = (name) => `${name}${lang === 'en' ? '.html' : '.en.html'}`;
  return [
    // 홈은 이 생성기가 아니라 `build-landing-page.mjs`가 만드는 서비스 소개 페이지다.
    // 그쪽이 함께 돌지 않으면 이 링크가 404가 되는데, 워크플로의 "Check internal links"가
    // 잡는다.
    `<a href="index${suffix}">${lang === 'en' ? 'Home' : '홈'}</a>`,
    // 문서 목록을 손으로 적으면 안 된다. FILE_FOR·TITLES와 달리 여기서 빠뜨리는 것은
    // **에러가 나지 않는다** — 새 문서가 제 URL로 배포는 되면서, 다른 어느 페이지의
    // nav에서도 목차에서도 닿지 않는 상태가 조용히 만들어진다. 파이프라인의 나머지와
    // 같이 LEGAL_DOCUMENTS에서 파생시킨다.
    ...Object.keys(LEGAL_DOCUMENTS).map(
      (key) => `<a href="${FILE_FOR[key]}${suffix}">${TITLES[lang][key]}</a>`,
    ),
    `<a href="account-deletion${suffix}">${lang === 'en' ? 'Account Deletion' : '계정 삭제'}</a>`,
    `<a href="${otherHref(current)}">${other}</a>`,
  ].join('\n');
};

/**
 * 개인정보처리방침에서 조문 하나를 통째로 떼어 온다.
 *
 * 제목 줄은 여는 괄호 앞에 공백이 있어("제3조 (보유 기간 및 파기)"), 본문 안의
 * 상호참조("제3조 2항", "Article 3(3)")와 섞이지 않는다. 조문의 끝은 다음 조문의 제목 줄로
 * 잡고, 마지막 조문이면 본문 끝까지다.
 */
const articleHeading = (lang, number) =>
  lang === 'en' ? `Article ${number} (` : `제${number}조 (`;

function privacyArticle(lang, number) {
  const body = legalBody('privacy', lang);
  const start = body.indexOf(articleHeading(lang, number));
  if (start === -1) {
    throw new Error(
      `개인정보처리방침(${lang})에서 "${articleHeading(lang, number)}…"를 찾지 못했다 — ` +
        '조문 번호가 바뀌었다면 이 파일의 RETENTION_ARTICLE도 함께 고칠 것.',
    );
  }
  const next = body.indexOf(articleHeading(lang, number + 1), start);
  return body.slice(start, next === -1 ? body.length : next).trim();
}

/** 보유 기간 및 파기. 계정 삭제 안내가 이 조문을 그대로 싣는다. */
const RETENTION_ARTICLE = 3;

/** 조문 제목은 소제목으로, 나머지는 조항 본문과 같은 방식(pre-wrap)으로 렌더한다. */
const retentionSection = (lang) => {
  const text = privacyArticle(lang, RETENTION_ARTICLE);
  const cut = text.indexOf('\n');
  return `<h2>${escapeHtml(text.slice(0, cut))}</h2>
${renderBody(text.slice(cut + 1))}`;
};

/**
 * 계정 삭제 요청 안내 — 스토어가 앱 내 삭제 경로와 **별개로** 요구하는 공개 페이지다.
 *
 * 이 파일이 직접 쓰는 것은 **삭제 방법**뿐이다(앱 안의 경로, 로그인이 안 될 때의 접수 주소).
 * 무엇이 지워지고 무엇이 남는지는 개인정보처리방침 제3조를 **그대로 실어서** 보여준다.
 *
 * 예전에는 같은 사실(6개월 동의 보관, 식별자를 제거한 원장, 신고 기록 예외, 위치정보법
 * 제16조 2항)을 한국어·영어로 각각 다시 적어 두고 "한쪽을 고치면 다른 쪽도 고칠 것"이라는
 * 주석 하나로 묶어 두었다. 그것이 바로 이 생성기가 없애려던 상태다 — 실제로 제3조 3항은
 * "운영 데이터베이스와 분리"가 구현과 달라 "전용 보관 표"로 한 번 정정됐고(compliance.md
 * 6장), 그런 정정이 다시 일어나면 조항은 고쳐지는데 공개된 이 페이지만 옛 설명을 계속
 * 주장하게 된다. 이제 고칠 곳은 조항 한 곳뿐이다.
 */
const DELETION = {
  ko: {
    title: '계정 삭제 요청',
    body: `<p>${APP_NAME} 계정은 앱 안에서 직접 삭제할 수 있습니다.</p>
<ul>
<li>앱 실행 → 로그인 → <strong>내정보 탭 → 회원 탈퇴</strong></li>
<li>안내에 따라 확인하면 즉시 처리되며, 별도의 승인 절차는 없습니다.</li>
</ul>
<p>앱에 로그인할 수 없는 등 앱 안에서 삭제할 수 없는 경우, 가입에 사용한 이메일 주소로
<a href="mailto:${CONTACT}">${CONTACT}</a>에 삭제를 요청해 주세요. 본인 확인 후 처리해 드립니다.</p>
<p>무엇이 지워지고 무엇이 남는지는 개인정보처리방침 제3조가 정합니다. 아래는 그 조항의
전문이며, 앱에서 동의하신 개인정보처리방침과 같은 원본에서 생성됩니다.</p>
${retentionSection('ko')}`,
  },
  en: {
    title: 'Account Deletion',
    body: `<p>You can delete your ${APP_NAME} account from within the app.</p>
<ul>
<li>Open the app → sign in → <strong>Profile tab → Delete Account</strong></li>
<li>Once you confirm, deletion is processed immediately. No approval step is required.</li>
</ul>
<p>If you cannot delete your account in the app (for example, you cannot sign in), send a
deletion request to <a href="mailto:${CONTACT}">${CONTACT}</a> from the email address you
signed up with. We will process it after verifying your identity.</p>
<p>What is deleted and what remains is governed by Article 3 of the Privacy Policy. Its full
text follows, generated from the same source as the Privacy Policy shown in the app.</p>
${retentionSection('en')}`,
  },
};

/**
 * 문서 목차(`legal.html`).
 *
 * 예전에는 이것이 `index.html`이었다. 사이트의 첫 화면이 서비스 소개 페이지로 바뀌면서
 * 이름을 옮겼다 — 스토어에 등록한 URL 네 개(privacy·terms·location-terms·account-deletion)는
 * 그대로이므로 이 이동으로 깨지는 등록 주소는 없다.
 */
const INDEX = {
  ko: {
    title: `${APP_NAME} 이용자 문서`,
    intro:
      '가입 시 동의를 받는 문서와 계정 삭제 안내입니다. 앱 안에 표시되는 것과 같은 내용이며, 같은 파일에서 생성됩니다.',
  },
  en: {
    title: `${APP_NAME} User Documents`,
    intro:
      'The documents you agree to at sign-up, and how to delete your account. This is the same text shown in the app, generated from the same source.',
  },
};

/** 생성기가 만든 디렉터리임을 표시한다. 남의 `web/`을 지우지 않기 위한 표식이다. */
const MARKER = '.generated-by-build-legal-pages';

/**
 * 출력 디렉터리를 비우고 새로 만든다.
 *
 * 통째로 지우는 이유는 문서 파일 이름이 바뀌었을 때 옛 파일이 남아 함께 배포되는 것을
 * 막기 위해서다. 다만 **표식이 없는 디렉터리는 지우지 않는다** — 누군가 루트에 진짜
 * `web/`을 만들어 두었다면 이 스크립트 한 번에 사라지는데, `.gitignore`에 걸려 있어
 * git으로 되돌릴 수도 없다.
 */
function resetOutDir() {
  if (existsSync(OUT_DIR)) {
    if (!existsSync(join(OUT_DIR, MARKER))) {
      throw new Error(
        `${OUT_DIR}가 이 생성기가 만든 디렉터리가 아니다(표식 ${MARKER} 없음). ` +
          '내용을 확인하고 직접 옮긴 뒤 다시 실행할 것.',
      );
    }
    rmSync(OUT_DIR, { recursive: true, force: true });
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, MARKER), '', 'utf8');
}

function build() {
  assertDocumentsCovered();
  resetOutDir();

  const write = (name, html) => writeFileSync(join(OUT_DIR, name), html, 'utf8');

  for (const lang of LANGS) {
    const suffix = lang === 'en' ? '.en.html' : '.html';

    for (const [key, doc] of Object.entries(LEGAL_DOCUMENTS)) {
      write(
        `${FILE_FOR[key]}${suffix}`,
        page({
          lang,
          title: TITLES[lang][key],
          meta:
            lang === 'en'
              ? `Revised ${doc.version}`
              : `개정일 ${doc.version}`,
          nav: navFor(lang, FILE_FOR[key]),
          content: renderBody(legalBody(key, lang)),
        }),
      );
    }

    write(
      `account-deletion${suffix}`,
      page({
        lang,
        title: DELETION[lang].title,
        meta: '',
        nav: navFor(lang, 'account-deletion'),
        content: DELETION[lang].body,
      }),
    );

    write(
      `legal${suffix}`,
      page({
        lang,
        title: INDEX[lang].title,
        meta: '',
        nav: navFor(lang, 'legal'),
        content: `<p>${INDEX[lang].intro}</p>
<ul>
${Object.keys(LEGAL_DOCUMENTS)
  .map(
    (key) =>
      `<li><a href="${FILE_FOR[key]}${suffix}">${TITLES[lang][key]}</a> — ${
        lang === 'en' ? 'revised' : '개정일'
      } ${LEGAL_DOCUMENTS[key].version}</li>`,
  )
  .join('\n')}
<li><a href="account-deletion${suffix}">${DELETION[lang].title}</a></li>
</ul>`,
      }),
    );
  }

  rmSync(BUILD_DIR, { recursive: true, force: true });
  console.log(`생성 완료: ${OUT_DIR}`);
}

build();
