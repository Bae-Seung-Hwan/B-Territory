/**
 * 서비스 소개 페이지 생성기 — 공개 URL의 첫 화면(`index.html`)을 만든다.
 *
 * B-Territory는 앱 서비스라 웹으로 접속할 곳이 없다. 그런데 공모전 지원서·스토어·명함이
 * 요구하는 "서비스 URL"은 심사자가 눌러 **무엇을 하는 서비스인지 알 수 있는 곳**이어야 한다.
 * 백엔드 도메인(b-territory.duckdns.org)은 API만 응답하므로 그 자리에 쓸 수 없다.
 * 그래서 법적 문서를 이미 내보내고 있는 GitHub Pages의 루트를 소개 페이지로 쓴다.
 *
 * 실행: `npm run build:site` (출력: `web/`)
 *
 * **`build-legal-pages.mjs` 다음에 돌아야 한다.** 그쪽이 `web/`을 통째로 지우고 새로 만들기
 * 때문이다(옛 파일이 남아 함께 배포되는 것을 막으려는 동작). 순서가 뒤집히면 소개 페이지만
 * 조용히 사라지므로, 아래 requireLegalBuild()가 그 상태를 에러로 세운다.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'web');

/**
 * 히어로·파비콘에 쓰는 아이콘.
 *
 * 앱 아이콘 원본은 스토어 제출용 1024px PNG라 800KB에 가깝다. 96px로 줄여 보여줄 뿐인데
 * 그것이 페이지에서 제일 무거운 것이 되고, 첫인상을 위해 존재하는 페이지의 첫 페인트를
 * 모바일에서 막는다. 그래서 웹용으로 줄여 둔 사본(`site-assets/icon.png`, 256px)을 쓰고,
 * 그것이 없으면 앱 아이콘으로 되돌아간다 — 사본은 어디까지나 같은 그림의 축소본이므로,
 * 아이콘을 새로 그리면 사본도 다시 만들어야 한다(`site-assets/README.md`).
 */
const ICON_CANDIDATES = [
  join(ROOT, 'site-assets', 'icon.png'),
  join(ROOT, 'frontend', 'assets', 'images', 'icon.png'),
];

/** 손으로 넣는 스크린샷 자리. 비어 있으면 스크린샷 섹션 자체를 만들지 않는다. */
const SHOTS_SRC = join(ROOT, 'site-assets', 'screenshots');

/** `build-legal-pages.mjs`가 출력 디렉터리에 남기는 표식. 그쪽과 같은 값이어야 한다. */
const LEGAL_MARKER = '.generated-by-build-legal-pages';

const APP_NAME = 'B-territory';
const SITE_URL = 'https://bae-seung-hwan.github.io/B-Territory/';
const REPO_URL = 'https://github.com/Bae-Seung-Hwan/B-Territory';

/**
 * 원스토어 앱 상세 페이지 주소.
 *
 * 비워 두면 내려받기 버튼이 링크가 아니라 "준비 중" 표시로 렌더된다 — 죽은 링크를 내보내는
 * 것보다 낫고, 주소가 비었다는 사실이 페이지에 그대로 드러난다.
 *
 * 경로의 `ko-kr`은 원스토어가 쓰는 로케일 세그먼트다. 영문 페이지에서도 같은 주소를 쓴다 —
 * 다른 로케일 경로가 실제로 사는지 확인하지 않았고, 확인하지 않은 주소를 내보내느니
 * 확인된 한 곳으로 보내는 편이 낫다.
 */
const STORE_URL = 'https://m.onestore.co.kr/v2/ko-kr/app/0001008950';

/** `build-legal-pages.mjs`와 같은 목록이어야 언어 전환이 서로 닿는다. */
const LANGS = ['ko', 'en'];

/**
 * 접수 주소는 앱이 이미 들고 있는 상수다. 이 한 줄 때문에 `build-legal-pages.mjs`처럼
 * tsc를 한 번 더 돌리는 것은 과하므로 소스에서 읽는다. 대신 못 찾으면 조용히 빈 값으로
 * 내려가지 않고 여기서 멈춘다 — 푸터에 문의처가 사라진 페이지가 배포되는 것보다 낫다.
 */
function contactEmail() {
  const source = readFileSync(
    join(ROOT, 'frontend', 'src', 'constants', 'contact.ts'),
    'utf8',
  );
  const found = source.match(/CONTACT_EMAIL\s*=\s*'([^']+)'/);
  if (!found) {
    throw new Error(
      'frontend/src/constants/contact.ts에서 CONTACT_EMAIL을 읽지 못했다 — ' +
        '선언 형태가 바뀌었다면 이 파일의 정규식도 함께 고칠 것.',
    );
  }
  return found[1];
}

const CONTACT = contactEmail();

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
 * 소개 문구.
 *
 * 여기 적는 기능은 **실제로 앱에 있는 것만이어야 한다.** 소개 페이지는 스토어 심사와 공모전
 * 심사가 함께 보는 곳이라, 없는 기능이 적혀 있으면 그대로 허위 기재가 된다.
 * 기능 설명의 출처는 `docs/lbs-service-description.md`(위치기반서비스 신고 첨부서류) 3장이며,
 * 그쪽을 고칠 일이 생기면 이 목록도 같이 본다.
 */
const COPY = {
  ko: {
    lang: '한국어',
    tagline: '걸어서 점령하는 부산',
    lead: '부산의 관광지를 직접 찾아가 점령하고, 국적으로 나뉜 팀이 부산 16개 구·군을 두고 겨루는 위치기반 관광 게임입니다.',
    cta: '원스토어에서 받기',
    ctaPending: '스토어 등록 준비 중',
    platform: 'Android · 무료',
    featuresTitle: '무엇을 하나요',
    features: [
      {
        title: '관광지 점령',
        body: '관광지 반경 안에서 인증을 요청하면 서버가 위치를 검증하고, 그 지점이 우리 팀 소유로 기록됩니다.',
      },
      {
        title: '구역 경쟁',
        body: '한 구(區) 안의 관광지를 많이 점령한 팀이 그 구를 차지합니다. 점령 현황은 지도 위에 팀 색으로 표시됩니다.',
      },
      {
        title: '국적이 곧 팀',
        body: '가입할 때 고른 국적으로 팀이 자동 배정됩니다. 같은 나라에서 온 여행자들과 한 편이 됩니다.',
      },
      {
        title: '결투',
        body: '근처에 있는 다른 팀 이용자를 탐지해, 미니게임으로 승부를 겨룰 수 있습니다.',
      },
      {
        title: '관광지 미션',
        body: '방문을 확인한 뒤 사진과 후기를 남깁니다. 점령과는 별개의 흐름입니다.',
      },
      {
        title: '순위와 기록',
        body: '팀 순위와 명예의 전당, 부산의 축제 일정, 같은 팀 이용자 간 실시간 채팅을 제공합니다.',
      },
    ],
    shotsTitle: '화면',
    shotAlt: {
      '01-map-busan.jpg': '부산 전역 지도. 구 경계가 그려져 있고 동구가 강조돼 있다.',
      '02-map-spots.jpg': '관광지 핀이 찍힌 지도와 카테고리 목록, 선택한 관광지의 점령 현황.',
      '03-claim.jpg': '관광지 상세 화면 — 사진과 주소, 점령 시도 버튼.',
      '04-district.jpg': '구 상세 화면 — 점령 여부와 점수 가중치.',
    },
    notesTitle: '알아두실 것',
    notes: [
      '관광지 정보는 한국관광공사가 제공하는 공공데이터(TourAPI)를 기반으로 구성했습니다.',
      '위치정보는 앱이 화면에 떠 있는 동안에만 이용하며, 백그라운드 위치 권한은 요청하지 않습니다.',
      '지도 표시는 단말 안에서 이루어지며, 이용자의 좌표를 지도 사업자에게 전송하지 않습니다.',
    ],
    docsTitle: '이용자 문서',
    docsLead:
      '가입할 때 동의를 받는 문서와 계정 삭제 안내입니다. 앱 안에 표시되는 것과 같은 내용이며, 같은 파일에서 생성됩니다.',
    docsLink: '문서 전체 보기',
    deletionLink: '계정 삭제 요청',
    repoLink: '소스 코드(GitHub)',
    contactLabel: '문의',
  },
  en: {
    lang: 'English',
    tagline: 'Claim Busan on foot',
    lead: 'A location-based tourism game: visit real spots in Busan to claim them, and compete for the 16 districts of Busan on a team decided by your nationality.',
    cta: 'Get it on ONE Store',
    ctaPending: 'Coming soon to the store',
    platform: 'Android · Free',
    featuresTitle: 'What you do',
    features: [
      {
        title: 'Claim tourist spots',
        body: 'Request verification inside a spot radius. The server checks your location, and the spot is recorded for your team.',
      },
      {
        title: 'District battles',
        body: 'The team holding the most spots in a district takes the district. The map shows every district in the colour of the team holding it.',
      },
      {
        title: 'Your nationality is your team',
        body: 'You are placed on a team by the nationality you pick at sign-up, alongside every traveller from your country.',
      },
      {
        title: 'Duels',
        body: 'The app finds players from other teams nearby, and you settle it with a mini-game.',
      },
      {
        title: 'Spot missions',
        body: 'Once your visit is confirmed, leave a photo and a review. This is separate from claiming.',
      },
      {
        title: 'Rankings and records',
        body: 'Team rankings, a hall of fame, festivals happening in Busan, and live chat with your own team.',
      },
    ],
    shotsTitle: 'Screens',
    shotAlt: {
      '01-map-busan.jpg':
        'A map of Busan with district borders drawn, one district highlighted.',
      '02-map-spots.jpg':
        'A map of tourist spot pins with a category list, and the claim status of the selected spot.',
      '03-claim.jpg':
        'A tourist spot detail screen with a photo, an address, and a claim button.',
      '04-district.jpg':
        'A district detail screen showing whether it is claimed and its score weight.',
    },
    notesTitle: 'Good to know',
    notes: [
      'Tourist spot data is built on TourAPI open data from the Korea Tourism Organization.',
      'Location is used only while the app is on screen. Background location permission is never requested.',
      'The map is drawn on your device; your coordinates are not sent to the map provider.',
    ],
    docsTitle: 'User documents',
    docsLead:
      'The documents you agree to at sign-up, and how to delete your account. This is the same text shown in the app, generated from the same source.',
    docsLink: 'See all documents',
    deletionLink: 'Account deletion',
    repoLink: 'Source code (GitHub)',
    contactLabel: 'Contact',
  },
};

const STYLE = `
:root { color-scheme: light dark;
  --fg: #1a1a1a; --muted: #666; --bg: #fff; --card: #f6f8fa; --line: #e2e2e2;
  --accent: #208AEF; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #e8e8e8; --muted: #a0a0a0; --bg: #16181c; --card: #1e2127; --line: #33363c;
    --accent: #6fb4f5; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif;
  -webkit-text-size-adjust: 100%; }
main { max-width: 54rem; margin: 0 auto; padding: 0 1.25rem 5rem; }
a { color: var(--accent); }

/* 히어로 — 앱 아이콘의 파랑을 그대로 쓴다. */
.hero { background: linear-gradient(160deg, #1E7FE0, #2F9BFF);
  color: #fff; text-align: center; padding: 3.5rem 1.25rem 3rem; margin-bottom: 3rem; }
.hero .inner { max-width: 40rem; margin: 0 auto; }
.hero img.icon { width: 96px; height: 96px; border-radius: 22px; display: block;
  margin: 0 auto 1.25rem; box-shadow: 0 6px 24px rgba(0,0,0,.22); }
.hero h1 { font-size: 2.1rem; line-height: 1.2; margin: 0 0 .35rem; letter-spacing: -.01em; }
.hero .tagline { font-size: 1.1rem; margin: 0 0 1.25rem; opacity: .92; }
.hero .lead { margin: 0 0 2rem; opacity: .92; }
.cta { display: inline-block; background: #fff; color: #1565C0; font-weight: 700;
  text-decoration: none; padding: .85rem 1.9rem; border-radius: 999px;
  box-shadow: 0 4px 16px rgba(0,0,0,.18); }
.cta.pending { background: rgba(255,255,255,.18); color: #fff; font-weight: 600;
  box-shadow: none; border: 1px solid rgba(255,255,255,.5); }
.platform { margin: .9rem 0 0; font-size: .875rem; opacity: .85; }
.langs { margin: 1.75rem 0 0; font-size: .875rem; }
.langs a { color: #fff; opacity: .9; }

h2 { font-size: 1.25rem; margin: 3rem 0 1.25rem; }
.cards { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  padding: 0; margin: 0; list-style: none; }
.cards li { background: var(--card); border: 1px solid var(--line); border-radius: 14px;
  padding: 1.25rem 1.35rem; }
.cards h3 { margin: 0 0 .4rem; font-size: 1rem; }
.cards p { margin: 0; color: var(--muted); font-size: .935rem; }

/* 스크린샷은 몇 장이 될지 정해져 있지 않아, 넘치면 가로로 스크롤한다. */
.shots { display: flex; gap: 1rem; overflow-x: auto; padding-bottom: .75rem; margin: 0; }
.shots img { height: 460px; width: auto; border-radius: 18px; border: 1px solid var(--line); }

.notes { color: var(--muted); font-size: .935rem; padding-left: 1.15rem; }
.notes li { margin-bottom: .5rem; }
p.docs-lead { color: var(--muted); }
.links { display: flex; flex-wrap: wrap; gap: .75rem 1.5rem; margin: 0; padding: 0;
  list-style: none; }
footer { margin-top: 3.5rem; padding-top: 1.25rem; border-top: 1px solid var(--line);
  color: var(--muted); font-size: .875rem; }
@media (max-width: 30rem) {
  .hero { padding: 2.75rem 1.25rem 2.5rem; }
  .hero h1 { font-size: 1.75rem; }
  .shots img { height: 380px; }
}
`;

/** 확장자로만 거른다 — 무엇을 넣을지는 사람이 정하고, 이름 순으로 늘어놓는다. */
const SHOT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function screenshots() {
  if (!existsSync(SHOTS_SRC)) return [];
  return readdirSync(SHOTS_SRC)
    .filter((name) => SHOT_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort();
}

function ctaHtml(copy) {
  if (!STORE_URL) {
    return `<span class="cta pending">${escapeHtml(copy.ctaPending)}</span>`;
  }
  return `<a class="cta" href="${escapeHtml(STORE_URL)}">${escapeHtml(copy.cta)}</a>`;
}

function render(lang, shots) {
  const copy = COPY[lang];
  const suffix = lang === 'en' ? '.en.html' : '.html';
  const other = lang === 'en' ? 'ko' : 'en';
  const otherSuffix = other === 'en' ? '.en.html' : '.html';
  const title = `${APP_NAME} — ${copy.tagline}`;
  // 한국어판은 디렉터리 인덱스라 `/`와 `/index.html` 두 주소로 같은 내용이 나온다. 공유
  // 미리보기와 검색이 한쪽으로 모이도록, 지원서·문서에 적은 주소인 `/`를 정본으로 삼는다.
  const canonical = lang === 'ko' ? SITE_URL : `${SITE_URL}index${suffix}`;

  const shotsSection = shots.length
    ? `<h2>${escapeHtml(copy.shotsTitle)}</h2>
<div class="shots">
${shots
  .map(
    (name) =>
      // 스크린샷 목록은 디렉터리에서 오고 설명은 COPY에 있다. 설명이 없는 파일을 넣어도
      // 페이지는 그대로 나오되, 그 한 장만 앱 이름으로 읽힌다.
      `<img src="screenshots/${encodeURIComponent(name)}" alt="${escapeHtml(copy.shotAlt[name] ?? APP_NAME)}" loading="lazy" />`,
  )
  .join('\n')}
</div>`
    : '';

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(copy.lead)}" />
<link rel="icon" href="icon.png" />
<link rel="canonical" href="${canonical}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(copy.lead)}" />
<meta property="og:image" content="${SITE_URL}icon.png" />
<meta property="og:url" content="${canonical}" />
<meta property="og:type" content="website" />
<style>${STYLE}</style>
</head>
<body>
<header class="hero">
<div class="inner">
<img class="icon" src="icon.png" alt="" />
<h1>${escapeHtml(APP_NAME)}</h1>
<p class="tagline">${escapeHtml(copy.tagline)}</p>
<p class="lead">${escapeHtml(copy.lead)}</p>
${ctaHtml(copy)}
<p class="platform">${escapeHtml(copy.platform)}</p>
<p class="langs"><a href="index${otherSuffix}">${escapeHtml(COPY[other].lang)}</a></p>
</div>
</header>
<main>
<h2>${escapeHtml(copy.featuresTitle)}</h2>
<ul class="cards">
${copy.features
  .map(
    (f) =>
      `<li><h3>${escapeHtml(f.title)}</h3><p>${escapeHtml(f.body)}</p></li>`,
  )
  .join('\n')}
</ul>
${shotsSection}
<h2>${escapeHtml(copy.notesTitle)}</h2>
<ul class="notes">
${copy.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('\n')}
</ul>
<h2>${escapeHtml(copy.docsTitle)}</h2>
<p class="docs-lead">${escapeHtml(copy.docsLead)}</p>
<ul class="links">
<li><a href="legal${suffix}">${escapeHtml(copy.docsLink)}</a></li>
<li><a href="account-deletion${suffix}">${escapeHtml(copy.deletionLink)}</a></li>
<li><a href="${REPO_URL}">${escapeHtml(copy.repoLink)}</a></li>
</ul>
<footer>${escapeHtml(APP_NAME)} · ${escapeHtml(copy.contactLabel)} <a href="mailto:${escapeHtml(CONTACT)}">${escapeHtml(CONTACT)}</a></footer>
</main>
</body>
</html>
`;
}

/**
 * 법적 문서 생성기가 먼저 돌았는지 확인한다. `web/`이 없거나 표식이 없다는 것은 이 생성기가
 * 먼저 돌았다는(=다음에 legal이 돌며 소개 페이지를 지운다) 뜻이다.
 *
 * 표식은 남으므로 이 확인이 잡는 것은 **첫 실행의 순서**뿐이다. 한 번 build:site를 돌린 뒤
 * legal만 다시 돌리는 경우는 여기서 걸리지 않는다 — 그쪽은 `build-legal-pages.mjs`의
 * warnIfPartialBuild()가 맡는다. 두 구멍을 각자의 생성기가 하나씩 막는 구조다.
 */
function requireLegalBuild() {
  if (!existsSync(join(OUT_DIR, LEGAL_MARKER))) {
    throw new Error(
      `${OUT_DIR}에 법적 문서 생성 결과가 없다. ` +
        'build-legal-pages.mjs가 web/을 비우고 다시 만들기 때문에 이 생성기는 그 뒤에 ' +
        '돌아야 한다 — `npm run build:site`로 실행할 것.',
    );
  }
}

/**
 * 아이콘이 하나도 없으면 여기서 멈춘다. 그냥 두면 `web/`을 이미 비운 뒤에 맨 ENOENT로
 * 죽어, CI 로그에는 경로만 남고 무엇이 잘못됐는지는 남지 않는다.
 */
function iconSource() {
  const found = ICON_CANDIDATES.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      `아이콘을 찾지 못했다 (${ICON_CANDIDATES.join(', ')}). ` +
        '앱 아이콘 경로가 바뀌었다면 이 파일의 ICON_CANDIDATES도 함께 고칠 것.',
    );
  }
  return found;
}

function build() {
  requireLegalBuild();

  copyFileSync(iconSource(), join(OUT_DIR, 'icon.png'));

  const shots = screenshots();
  if (shots.length) {
    mkdirSync(join(OUT_DIR, 'screenshots'), { recursive: true });
    for (const name of shots) {
      copyFileSync(join(SHOTS_SRC, name), join(OUT_DIR, 'screenshots', name));
    }
  }

  for (const lang of LANGS) {
    const suffix = lang === 'en' ? '.en.html' : '.html';
    writeFileSync(join(OUT_DIR, `index${suffix}`), render(lang, shots), 'utf8');
  }

  console.log(
    `소개 페이지 생성 완료: ${OUT_DIR} (스크린샷 ${shots.length}장` +
      `${STORE_URL ? '' : ', 스토어 주소 미설정'})`,
  );
}

build();
