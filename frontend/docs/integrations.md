# 외부 연동

앱이 바깥 서비스와 맞닿는 지점만 다룬다. 앱 내부 설계(상태 관리, 라우팅)는
[architecture.md](./architecture.md), 미해결 항목은 [known-issues.md](./known-issues.md) 참고.

## Google Maps

- 구현 위치: `src/components/map/BusanMapView.tsx` (react-native-maps 네이티브)
  - `DistrictPolygons.tsx` — 구 경계 폴리곤(그래프 컬러링 폴백 팔레트, 향후 점령 상태 연동 지점)
  - `SpotMarkers.tsx` — 관광지 마커(react-native-svg 커스텀 핀, 카테고리 필터/줌 자동 숨김, 뷰포트 필터링)
  - `CategoryFilterPanel.tsx` — 카테고리 on/off 오버레이
  - `CurrentLocationMarker.tsx` — 현재 위치 pulse 마커(react-native-reanimated)
- HUD: `src/components/map/MapHUD.tsx` (1위팀 · 이번주 수도 표시)
- 필요 환경변수: `GOOGLE_MAPS_ANDROID_API_KEY` / `GOOGLE_MAPS_IOS_API_KEY` ([setup.md](./setup.md) 참고). `EXPO_PUBLIC_` 접두사가 없어 클라이언트 JS 번들에 노출되지 않고, `app.config.js`의 `react-native-maps` config plugin이 prebuild 시점에 네이티브 매니페스트/Info.plist에만 주입한다.
- Google Cloud Console에서 "Maps SDK for Android"/"Maps SDK for iOS" 활성화, API 키를 패키지명(`com.bterritory.app`) + SHA-1(Android) / Bundle ID(iOS)로 제한해서 발급받는다.
- Dev Build 필요(WebView JS SDK와 달리 네이티브 모듈) — 전환 배경은 [decisions/0001-expo-go-vs-dev-build.md](./decisions/0001-expo-go-vs-dev-build.md) 참고.

### 이전 방식(카카오맵 WebView)에서 전환한 이유

기존엔 `KakaoMapView.tsx`가 WebView에 카카오맵 JS SDK를 주입하는 방식이었는데, `EXPO_PUBLIC_KAKAO_MAP_KEY`가 클라이언트 번들에 그대로 노출되고 WebView `baseUrl`이 고정된 `'http://localhost'`라 사이트 도메인 제한도 사실상 무력화되는 문제가 있었다. 네이티브 지도 SDK(Dev Build)로 전환하면서 앱 서명(패키지명/SHA-1, Bundle ID) 기반의 실효성 있는 키 제한이 가능해졌다.

### 확장 포인트 (점령 시각화 / 실시간 소켓)

- `BusanMapView`는 `occupiedDistricts`/`onDistrictPress` 같은 prop을 받지 않는다(`style`/`spots`/`coords`/`onReady`뿐). `onDistrictPress`는 `DistrictPolygons`가 갖는 prop이고, `BusanMapView`가 내부적으로 이미 배선해(`handleDistrictPress`) 탭 시 `DistrictDetailSheet`를 연다 — 외부에서 값을 넘기는 지점이 아니다.
- 점령 색상도 아직 연결돼 있지 않다. `DistrictPolygons.tsx`는 `src/utils/districtColors.ts#getDistrictFillColor(sigCd)`가 반환하는 그래프 컬러링 폴백 팔레트를 모듈 로드 시점에 `DISTRICT_RINGS`로 구워 두고 쓴다 — `sigCd`만 받는 시그니처라 지금 형태로는 점령 맵을 반영할 수 없다.
- `useGameStore`의 `occupiedDistricts`가 실제로 채워지면, `districtColors.ts`에 이미 적혀 있는 설계 의도대로 `DistrictPolygons`가 그 스토어를 직접 구독하게 만든다(`MapHUD`가 같은 방식으로 읽는다) — `BusanMapView`에 신규 prop을 추가하는 방향이 아니다.
- `BusanMapView`는 `useSocket()`이나 어떤 스토어도 직접 구독하지 않는 controlled 컴포넌트로 유지했다. 실시간 플레이어 위치 같은 데이터가 필요해지면 `spots`/`coords`와 동일한 패턴으로 신규 prop을 추가하면 되고, 소켓 배선 자체는 `map/index.tsx`(또는 상위)에서 처리한다.

## 실시간 통신 (Socket.io)

> ⚠️ 소켓 연결·이벤트 배선이 아직 구현되어 있지 않다 (스켈레톤만 존재). 남은 작업은
> [known-issues.md](./known-issues.md#실시간-통신-socketio) 참고.

- 구현 위치: `src/providers/SocketProvider.tsx`
- 앱 루트(`src/app/_layout.tsx`)에서 QueryClient와 함께 최상단에 마운트
- `useSocket()`으로 소켓 인스턴스를 꺼내 쓸 수 있는 Context만 제공 — `autoConnect: false`라 실제 연결은 아무도 시작하지 않음
- 오버레이(`useOverlayStore`)는 `EnemyDetectionAlert` → `DuelRequest` → `MiniGame` 화면 흐름만 갖추고 있고, 이 체인을 트리거하는 `setShowEnemyAlert(true)` / `setEnemyInfo(...)` 호출이 코드 어디에도 없어 실제로 뜰 방법이 없음
- `useLocation()`(`src/hooks/use-location.ts`)은 지도 화면(`map/index.tsx`)에서 호출돼 좌표를 얻고 있지만, 그 좌표를 `location:update`로 보내는 쪽이 없어 서버는 여전히 위치를 모름
- 백엔드(PR #13, `feature/Bae/realtime-duel`)가 이미 제공하는 이벤트: 송신 `location:update`, 수신 `encounter:detected`/`duel:requested`/`duel:accepted`/`duel:rejected`/`duel:completed`/`duel:voided`/`duel:expired`, 송신 `duel:request`/`duel:accept`/`duel:reject`/`duel:result` — 실제 배선 시 백엔드 코드에서 페이로드 스키마 재확인 필요

## Firebase Authentication

이메일/비밀번호 로그인·가입, Google 로그인(현재 임시 비활성화 — 아래 참고), Apple 로그인 골격까지 구현되어 있음.

네이티브 모듈이 필요 없는 `firebase` JS SDK를 쓴다. Expo Go를 쓰던 시절에 그래서 골랐고, Dev
Build로 전환한 지금도 그대로 쓰고 있다. 세션 영속화만
`@react-native-async-storage/async-storage`로 붙였다(`src/lib/firebase.ts`의
`initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })`).

인증 상태를 앱 안에서 어떻게 들고 있는지는
[architecture.md의 "상태 관리 설계"](./architecture.md#상태-관리-설계) 참고.

### 인증 흐름

1. **로그인**: Firebase Authentication SDK(이메일/비밀번호, 소셜 로그인 등)로 로그인 → Firebase가 **ID Token** 발급
2. **가입 여부 확인**: 로그인 화면에서 로그인 성공 직후, 발급받은 ID Token으로 `GET /api/auth/me` 호출 (`login.tsx`의 `finishLogin`에서만 호출됨)
   - `200` → 이미 가입된 사용자. 응답 프로필(`id`/`email`/`nickname`/`nationality`/`team`)이 `queryKeys.auth.me` 캐시에 담기고 바로 메인 화면 진입
   - `404` → Firebase 계정은 있지만 백엔드 프로필이 없음. 예전엔 회원가입 화면으로 자동 이동시켰으나, [계정 불일치 문제](./known-issues.md#firebase--백엔드-계정-불일치) 때문에 지금은 이메일/비밀번호를 다시 확인해달라는 alert만 띄우고 로그인 화면에 머무름. 이때 `signOut(auth)`으로 세션도 함께 정리해, 프로필 없는 토큰이 이후 요청에 계속 붙거나 다음 부팅 때 어정쩡한 상태로 남지 않게 한다
   - 신규 가입은 이 흐름과 별개로 진행됨: 로그인 화면의 "회원가입 하기" 링크 → 약관 동의 바텀시트 → `use-registration-flow.ts`에서 `createUserWithEmailAndPassword` → 이메일 인증 → `POST /api/auth/register` 호출 (최초 1회만; 재호출 시 `409`)
3. **보관**: ID Token은 Firebase SDK가 AsyncStorage에 보관하고, 프로필은 React Query 캐시(`queryKeys.auth.me`) **한 곳에만** 둔다
4. **요청 시 첨부**: 인증이 필요한 API 호출 시 `Authorization: Bearer <idToken>` 헤더로 전송
5. **갱신**: ID Token은 약 1시간 후 만료된다. `src/lib/api-client.ts`의 axios 인터셉터가 요청마다 `getIdToken()`을 붙이고, `401`이 오면 `getIdToken(true)`로 강제 갱신한 뒤 원요청을 1회 재시도한다

### 이메일 인증 (Firebase 내장)

과거엔 Resend로 자체 발송하는 매직링크(`/api/email/send-link`+`verify-token`, `app/verify.tsx`)를 썼으나, 발신 도메인 구매·DKIM 설정 없이는 실사용이 불가능해(테스트 모드는 계정 소유자 본인에게만 발송) **Firebase 내장 이메일 인증(`email_verified` 클레임)으로 전환했다.** 백엔드 PR #26(`feature/Bae/firebase-email-verification`)이 짝을 이루는 변경이며, 반드시 함께 머지돼야 한다(한쪽만 가면 프론트는 새 흐름인데 백엔드는 옛 마커를 찾다가 403, 또는 그 반대로 마커 없이도 통과되는 구멍이 생긴다).

`register()`가 여전히 게이트를 걸지만(`auth.service.ts`), 이제 확인하는 값이 Redis 마커가 아니라 `FirebaseAuthGuard`가 디코딩한 ID Token의 `email_verified` 클레임이다(`req.user.email_verified`). `/api/email/*` 엔드포인트와 `EmailService`/`MailService`는 백엔드에서 완전히 삭제됐다.

**프론트 상태기계** (오케스트레이션은 `hooks/use-registration-flow.ts`, 재발송은 `hooks/use-firebase-email-verification.ts`, 렌더링만 `app/(auth)/register.tsx`):

1. 폼 제출 → `createUserWithEmailAndPassword` (또는 `auth/email-already-in-use`면 같은 자격증명으로 `signInWithEmailAndPassword`, "이어서 가입")
2. 계정이 이미 `emailVerified`면 곧장 3번으로. 아니면 `sendEmailVerification(user)` 호출(Firebase가 자체 호스팅 페이지로 링크를 보낸다 — 우리 쪽에 `/verify` 라우트 불필요) 후 "인증 대기" 단계로 전환
3. 사용자가 메일 링크를 클릭하고 앱으로 돌아와 "인증 완료했어요"를 누르면: `user.reload()` → `emailVerified` 확인 → **`user.getIdToken(true)`로 강제 토큰 갱신** → `POST /api/auth/register`
4. 강제 갱신이 핵심 gotcha다 — `api-client.ts`의 요청 인터셉터는 캐시된(강제 아닌) `getIdToken()`을 쓰므로, 이걸 빼먹으면 방금 인증한 사용자도 낡은 토큰(`email_verified:false`) 때문에 정상 인증자인데 403을 받는다.
5. 미인증 상태에서 "완료" 클릭 → 안내 알럿만 띄우고 `register` 호출 없음. 발송 실패해도 대기 단계로는 넘어간다(계정은 이미 생겼으므로 폼에 갇히면 재제출 시 롤백 판정이 꼬인다) — 재발송은 대기 화면에서 다시 시도.
6. 인증 없이 가입을 시도하면(이론상 위 상태기계에서 도달 불가) `403` → `api-errors.ts`가 "이메일 인증이 필요합니다"로 매핑(방어용으로 유지).

**콜드스타트(앱 재시작) 복귀.** 계정 생성까지 마쳤지만 미인증인 상태로 앱이 완전히 꺼졌다 켜지면, `AuthProvider`(세션 확인 전엔 화면 자체를 마운트하지 않음)가 이미 확정한 `auth.currentUser`를 `useRegistrationFlow`가 **lazy initializer**로 읽어 첫 렌더부터 곧장 "인증 대기" 단계로 시작한다(깜빡임 없이). 이번 컴포넌트 인스턴스가 계정을 만든 게 아니므로 롤백(`user.delete()`) 대상에서는 제외된다. 닉네임/국적 입력창은 폼·대기 두 단계 모두에서 노출해, `use-register-draft.ts`의 초안(최대 24시간 보관)이 그새 만료돼 비어있어도 그 자리에서 다시 채워 이어서 완료할 수 있다.

**앱을 종료했다 돌아와도 이어서 가입할 수 있다.** 위 콜드스타트 복귀 덕분에 가입 자체는 아무 때나 마치면 된다. 다만 비밀번호는 `use-register-draft.ts`에 담기지 않으므로 복원 후 다시 입력해야 한다.

### 백엔드와의 관계

- 백엔드는 `FirebaseAuthGuard`로 이 ID Token을 검증하고, 통과 시 `req.user = { uid, email }`을 주입 ([backend/docs/API.md](../../backend/docs/API.md) 참고)
- 인증이 필요한 API 2개, 응답 형태 동일(`{ id, email, nickname, nationality, team }`, `team`은 가입 시 `nationality`와 자동 동일하게 설정):
  - `POST /api/auth/register` — 회원가입(최초 1회). Firebase 계정에 이메일이 없으면(전화번호/익명 로그인 등) `400`, 이미 가입된 사용자면 `409`
  - `GET /api/auth/me` — 가입 여부 확인 + 프로필 조회. 로그인 직후 항상 먼저 호출해야 함. 미가입 시 `404`
- 백엔드 코드에 `JwtStrategy`(자체 발급 JWT)도 존재하지만 어떤 API에도 연결되어 있지 않음 → 프론트는 자체 JWT를 신경 쓸 필요 없이 **Firebase ID Token만** 다루면 됨

> ⚠️ Firebase 계정과 백엔드 프로필이 어긋나 고착되는 경우가 있다 —
> [known-issues.md](./known-issues.md#firebase--백엔드-계정-불일치) 참고.

### Google 로그인 — 임시 비활성화

구현(`src/hooks/use-google-login.ts`, `expo-auth-session` generic `useAuthRequest` +
`GoogleAuthProvider.credential`)은 남아 있지만 `login.tsx`가 호출하지 않고 "준비 중" alert만 띄우는
스텁(`handleGoogleLogin`)을 노출한다.

> **현재 상태:** 비활성화 사유였던 Expo Go 제약은 Dev Build 전환으로 해소됐지만 스텁은 아직
> 그대로다. 즉 아래 설명은 비활성화의 *배경*이고, 지금은 되돌릴 수 있는 상태인데 아직 되돌리지
> 않은 것이다.

Google의 OAuth "Web" 클라이언트는 redirect URI로 `http`/`https`만 허용해 커스텀 스킴(`exp://...`)을 거부한다. 따라서 Expo Go 앱으로 실기기/시뮬레이터에서 실행하면 `AuthSession.makeRedirectUri({ scheme: 'b-territory' })`가 `exp://...` 형태가 되어 Google이 `redirect_uri_mismatch`로 거부하는 게 **정상 동작**이다. 예전에 이를 우회하던 Expo `auth.expo.io` 프록시는 최신 `expo-auth-session`에서 제거됐다.

문제는 여기서 그치지 않는다: 실기기(Expo Go)에서 이 mismatch 에러 화면을 X로 닫으면 Auth Session이 비정상 종료되면서 **Expo Go 앱 자체가 꺼지는 문제**가 확인되어, 구글 로그인 버튼을 Apple 로그인과 동일한 스텁으로 임시 전환해뒀다.

- **지금 검증 가능한 방법**: `npm run web`(`expo start --web`) — redirect URI가 `http://localhost:...`가 되어 Google이 허용. 단 실기기 버튼은 스텁 상태라 알럿만 뜨므로, 실제 로그인을 확인하려면 웹에서 `login.tsx`에 `useGoogleLogin` 호출을 임시로 되돌려야 함
- **재활성화 방법**: 네이티브 `@react-native-google-signin/google-signin`으로 교체하면서 `login.tsx`의 스텁을 실제 훅 호출로 되돌린다. Dev Build 전환은 이미 끝났으므로 지금 착수 가능하다
- **설정 필요(재활성화 시)**: Firebase 콘솔 → Authentication → Sign-in method → Google 활성화 시 자동 발급되는 **Web client ID**를 `.env`의 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`에 채워야 함(콘솔 접근 권한이 있는 사람이 직접)

## Apple Sign In

> ⚠️ 골격만 구현됨 — `src/components/auth/AppleSignInButton.tsx`는 iOS에서만 렌더링되고, 탭하면 "준비 중" alert만 뜨는 비활성 버튼. App Store 심사 Guideline 4.8(소셜 로그인 제공 시 Apple 로그인도 필수)에 대비한 자리만 마련해둔 상태.

네이티브 모듈(`expo-apple-authentication`)이 필요하다. Dev Build로는 이미 전환했고
`app.config.js`에 `ios.bundleIdentifier`(`com.bterritory.app`)도 설정돼 있어 전제 조건 자체는
갖춰졌다. 다만 `eas.json`에는 아직 android 프로필만 있어 iOS 빌드를 한 번도 돌리지 않았다.

남은 작업은 [known-issues.md](./known-issues.md#apple-sign-in) 참고.
