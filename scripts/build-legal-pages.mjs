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
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
/** 방침 제9조 3항·제10조에 적힌 접수 주소. 바꾸려면 그 조항부터 고칠 것. */
const CONTACT = 'B.territory123@gmail.com';

function loadDocuments() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  // 프론트엔드의 로컬 typescript를 node로 직접 실행한다 — npx는 셸 래퍼(.cmd)라
  // 플랫폼마다 spawn 방식이 달라진다.
  // rootDir을 src로 잡아 출력이 `<BUILD_DIR>/legal/index.js`로 떨어지게 한다.
  execFileSync(
    process.execPath,
    [
      join(FRONTEND, 'node_modules', 'typescript', 'bin', 'tsc'),
      'src/legal/index.ts',
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
  return require(join(BUILD_DIR, 'legal', 'index.js'));
}

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
<footer>${APP_NAME} · 문의 <a href="mailto:${CONTACT}">${CONTACT}</a></footer>
</main>
</body>
</html>
`;
}

const navFor = (lang) => {
  const t = TITLES[lang];
  const suffix = lang === 'en' ? '.en.html' : '.html';
  const other = lang === 'en' ? '한국어' : 'English';
  const otherHref = (name) =>
    `${name}${lang === 'en' ? '.html' : '.en.html'}`;
  return [
    `<a href="index${suffix}">${lang === 'en' ? 'Home' : '홈'}</a>`,
    `<a href="terms${suffix}">${t.service}</a>`,
    `<a href="privacy${suffix}">${t.privacy}</a>`,
    `<a href="location-terms${suffix}">${t.location}</a>`,
    `<a href="account-deletion${suffix}">${lang === 'en' ? 'Account Deletion' : '계정 삭제'}</a>`,
    `<a href="${otherHref('index')}">${other}</a>`,
  ].join('\n');
};

/**
 * 계정 삭제 요청 안내 — 스토어가 앱 내 삭제 경로와 **별개로** 요구하는 공개 페이지다.
 * 무엇이 지워지고 무엇이 남는지는 개인정보처리방침 제3조와 같은 사실을 서술한다. 한쪽을
 * 고치면 다른 쪽도 함께 고칠 것.
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

<h2>삭제되는 정보</h2>
<p>이메일 주소, 닉네임, 국적, 인증 식별자 등 이용자를 직접 식별하는 정보는 서비스 운영
데이터베이스에서 지체 없이 삭제되며, 로그인에 사용한 인증 계정도 함께 삭제됩니다.</p>

<h2>삭제 후에도 남는 정보</h2>
<p>아래 항목은 다른 이용자의 기록과 결합되어 있거나 법령·분쟁 대응에 필요하여 남습니다.
자세한 내용은 개인정보처리방침 제3조를 참고해 주세요.</p>
<ul>
<li>점수 원장, 점령 기록, 결투 기록, 미션 사진·후기 — <strong>이용자 식별자를 제거한 형태</strong>로 남습니다.</li>
<li>신고 기록 — 신고 당시 닉네임과 신고된 메시지 내용이 함께 남습니다. 신고 처리와 재발 방지에 필요한 자료입니다.</li>
<li>약관 동의 이력 — 동의한 문서의 종류·개정일, 만 14세 이상 확인 여부, 동의 일시, 그리고 그 이력을 특정하기 위한 이메일 주소를 전용 보관 표에서 <strong>6개월간 보관한 뒤 파기</strong>합니다. 이 표는 서비스 운영에 사용하지 않으며, 탈퇴한 이용자를 식별하거나 재가입을 제한하거나 광고·통계에 이용하지 않습니다. 열람·파기를 요구하실 수 있습니다.</li>
<li>위치정보 이용·제공사실 확인자료 — 위치정보의 보호 및 이용 등에 관한 법률 제16조 제2항에 따라 <strong>6개월간</strong> 보존됩니다.</li>
</ul>`,
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

<h2>What is deleted</h2>
<p>Information that directly identifies you — email address, nickname, nationality and
authentication identifiers — is deleted from the service database without delay, together
with the authentication account used to sign in.</p>

<h2>What remains after deletion</h2>
<p>The following remain because they are combined with other users' records or are required
by law or for dispute handling. See Article 3 of the Privacy Policy for details.</p>
<ul>
<li>Score ledger, territory claims, duel records, mission photos and reviews — retained <strong>with user identifiers removed</strong>.</li>
<li>Report records — the nickname at the time of the report and the reported message content remain, as they are required to handle reports and prevent recurrence.</li>
<li>Consent records — the documents and revision dates you agreed to, whether you confirmed being 14 or older, the time of consent, and the email address used to identify that record are kept in dedicated archive tables for <strong>six months and then destroyed</strong>. These tables are not used to operate the service, to identify former users, to restrict re-registration, or for advertising or statistics. You may request access to, or destruction of, this record.</li>
<li>Location usage records — retained for <strong>six months</strong> under Article 16(2) of the Act on the Protection and Use of Location Information.</li>
</ul>`,
  },
};

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

function build() {
  const { LEGAL_DOCUMENTS, legalBody } = loadDocuments();
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const write = (name, html) => writeFileSync(join(OUT_DIR, name), html, 'utf8');
  const fileFor = { service: 'terms', privacy: 'privacy', location: 'location-terms' };

  for (const lang of ['ko', 'en']) {
    const suffix = lang === 'en' ? '.en.html' : '.html';
    const nav = navFor(lang);

    for (const [key, doc] of Object.entries(LEGAL_DOCUMENTS)) {
      write(
        `${fileFor[key]}${suffix}`,
        page({
          lang,
          title: TITLES[lang][key],
          meta:
            lang === 'en'
              ? `Revised ${doc.version}`
              : `개정일 ${doc.version}`,
          nav,
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
        nav,
        content: DELETION[lang].body,
      }),
    );

    write(
      `index${suffix}`,
      page({
        lang,
        title: INDEX[lang].title,
        meta: '',
        nav,
        content: `<p>${INDEX[lang].intro}</p>
<ul>
${Object.keys(LEGAL_DOCUMENTS)
  .map(
    (key) =>
      `<li><a href="${fileFor[key]}${suffix}">${TITLES[lang][key]}</a> — ${
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
