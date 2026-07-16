# 외부 연동

## 카카오맵

- 구현 위치: `src/components/map/KakaoMapView.tsx` (WebView + 카카오 JS SDK)
- HUD: `src/components/map/MapHUD.tsx` (1위팀 · 이번주 수도 표시)
- 필요 환경변수: `EXPO_PUBLIC_KAKAO_MAP_KEY` ([setup.md](./setup.md) 참고)
- 카카오 개발자 콘솔 → 플랫폼 → Web → 사이트 도메인에 사용 도메인 등록 필요

### API 키 노출 대응

> ⚠️ `EXPO_PUBLIC_` 접두사 환경변수는 클라이언트 번들에 그대로 포함되어 누구나 추출 가능. 이 키는 **JavaScript 키**(WebView JS SDK용)로, 카카오 콘솔에서 지원하는 제한 방식 중:
> - **네이티브 앱 키 제한(Android 패키지명/iOS Bundle ID)** → JS 키에는 적용 불가
> - **사이트 도메인 제한** → 이론상 적용되지만, `baseUrl`이 `KakaoMapView.tsx`에 하드코딩된 `'http://localhost'`(실제 서버 주소가 아니라 WebView가 자체 선언하는 가상 origin)라서, 키를 탈취한 누구든 동일하게 `baseUrl: 'http://localhost'`인 WebView를 만들면 도메인 검사를 그대로 통과함 → **사실상 무력화**
>
> 즉 이 구조(JS 키 + WebView + 고정 `localhost` origin)에서 네이티브 제한도 도메인 제한도 실효성이 없어, 아래 사용량 기반 대응이 실질적인 방어선.

**대응 방법**
1. 카카오 콘솔 사용량 모니터링 설정 — 비정상 트래픽 감지
2. 쿼터 제한 설정 — 일정량 초과 시 자동 차단
3. 앱 배포 시 번들 ID 등록 — Android 패키지명, iOS Bundle ID를 카카오 콘솔에 등록 (단, 위 이유로 WebView JS SDK에는 이 제한이 적용되지 않아 심리적 안전판 이상의 효과는 없음)

### 필요 작업 (TODO)

- [ ] 카카오 콘솔에 일일/월간 쿼터 제한값 설정 및 초과 시 알림 채널 연결
- [ ] 사용량 모니터링 대시보드/알림 주기 확인 방법 정리
- [ ] (선택) 근본적 해결이 필요해지면 ① 지도 타일/API 요청을 백엔드 프록시로 우회해 키를 클라이언트에 노출하지 않는 방식, ② WebView JS SDK 대신 네이티브 지도 SDK(Dev Build 필요, `docs/decisions/0001-expo-go-vs-dev-build.md` 참고)로 전환해 실제 앱 서명 기반 제한을 받는 방식 중 검토

## 실시간 통신 (Socket.io)

> ⚠️ 2026-07-16 기준 소켓 연결·이벤트 배선이 아직 구현되어 있지 않음 (스켈레톤만 존재)

- 구현 위치: `src/providers/SocketProvider.tsx`
- 앱 루트(`src/app/_layout.tsx`)에서 QueryClient와 함께 최상단에 마운트
- `useSocket()`으로 소켓 인스턴스를 꺼내 쓸 수 있는 Context만 제공 — `autoConnect: false`라 실제 연결은 아무도 시작하지 않음
- 오버레이(`useOverlayStore`)는 `EnemyDetectionAlert` → `DuelRequest` → `MiniGame` 화면 흐름만 갖추고 있고, 이 체인을 트리거하는 `setShowEnemyAlert(true)` / `setEnemyInfo(...)` 호출이 코드 어디에도 없어 실제로 뜰 방법이 없음
- `useLocation()`(`src/hooks/use-location.ts`) GPS 훅도 어느 화면에서도 호출되지 않아, 위치를 소켓으로 보낼 지점 자체가 없음
- 백엔드(PR #13, `feature/Bae/realtime-duel`)가 이미 제공하는 이벤트: 송신 `location:update`, 수신 `encounter:detected`/`duel:requested`/`duel:accepted`/`duel:rejected`/`duel:completed`/`duel:voided`/`duel:expired`, 송신 `duel:request`/`duel:accept`/`duel:reject`/`duel:result` — 실제 배선 시 백엔드 코드에서 페이로드 스키마 재확인 필요

### 필요 작업 (TODO)

- [ ] 소켓 연결 시작 시점 결정 (로그인 직후 vs 지도 화면 진입 시) 및 `SocketProvider`에 `connect()`/재연결·에러 처리 구현
- [ ] `useLocation()`을 지도 화면(`src/app/(main)/map/index.tsx`)에 연결하고, 좌표를 `location:update`로 보내는 주기/쓰로틀링 결정
- [ ] `encounter:detected` 등 수신 이벤트를 `useOverlayStore`/`useGameStore`에 연결하는 지점 설계 (Provider 레벨 일괄 배선 권장 — PR #17 리뷰 코멘트 참고)
- [ ] `DuelRequest`/`MiniGame`의 버튼 액션(`handleAccept` 등)을 실제 `duel:accept`/`duel:result` 소켓 emit으로 교체

## Firebase Authentication

> ⚠️ 2026-07-16 기준 `firebase` JS SDK는 설치만 된 상태 (`package.json`) — 초기화 코드(`src/lib/firebase.ts`)와 로그인/회원가입 화면 연동은 아직 구현 전

### 인증 흐름

1. **로그인**: Firebase Authentication SDK(이메일/비밀번호, 소셜 로그인 등)로 로그인 → Firebase가 **ID Token** 발급
2. **가입 여부 확인**: 발급받은 ID Token으로 `GET /api/auth/me` 호출
   - `200` → 이미 가입된 사용자. 응답 프로필(`id`/`email`/`nickname`/`nationality`/`team`)을 `useUserStore`에 채우고 바로 메인 화면 진입
   - `404` → 미가입. 회원가입 화면으로 이동 후 `POST /api/auth/register` 호출 (최초 1회만; 재호출 시 `409`)
3. **보관**: ID Token과 위에서 받은 프로필 값들을 클라이언트에 보관 (예: `useUserStore`)
4. **요청 시 첨부**: 인증이 필요한 API 호출 시 `Authorization: Bearer <idToken>` 헤더로 전송
5. **갱신**: ID Token은 약 1시간 후 만료되므로, Firebase SDK의 갱신 함수로 주기적으로 재발급 필요

### 백엔드와의 관계

- 백엔드는 `FirebaseAuthGuard`로 이 ID Token을 검증하고, 통과 시 `req.user = { uid, email }`을 주입 ([backend/docs/API.md](../../backend/docs/API.md) 참고)
- 인증이 필요한 API 2개, 응답 형태 동일(`{ id, email, nickname, nationality, team }`, `team`은 가입 시 `nationality`와 자동 동일하게 설정):
  - `POST /api/auth/register` — 회원가입(최초 1회). Firebase 계정에 이메일이 없으면(전화번호/익명 로그인 등) `400`, 이미 가입된 사용자면 `409`
  - `GET /api/auth/me` — 가입 여부 확인 + 프로필 조회. 로그인 직후 항상 먼저 호출해야 함. 미가입 시 `404`
- 백엔드 코드에 `JwtStrategy`(자체 발급 JWT)도 존재하지만 어떤 API에도 연결되어 있지 않음 → 프론트는 자체 JWT를 신경 쓸 필요 없이 **Firebase ID Token만** 다루면 됨

### 필요 작업 (TODO)

- [x] frontend에 Firebase SDK 설치 — `firebase`(JS SDK) + `@react-native-async-storage/async-storage`. Expo Go 유지 중이라 네이티브 모듈이 필요 없는 JS SDK를 선택했고, Dev Build 전환 후에도 그대로 사용 가능 ([decisions/0001-expo-go-vs-dev-build.md](./decisions/0001-expo-go-vs-dev-build.md) 참고)
- [ ] Firebase 프로젝트 설정값(`apiKey`/`authDomain`/`projectId`/`appId`) 확보 — 백엔드 `.env`의 `FIREBASE_PROJECT_ID`와 동일한 Firebase 프로젝트 사용, `EXPO_PUBLIC_FIREBASE_*`로 `.env`/`.env.example`에 추가
- [ ] `src/lib/firebase.ts` 작성 — `initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })`로 세션 유지 설정
- [ ] `login.tsx`의 `handleLogin` TODO를 `signInWithEmailAndPassword` → ID Token 발급 → `GET /api/auth/me` 호출 → 200/404 분기로 교체
- [ ] `register.tsx`의 `handleSubmit` TODO를 `createUserWithEmailAndPassword` → ID Token 발급 → `POST /api/auth/register` 호출로 교체 (현재는 백엔드 호출 없이 `useUserStore`만 채우고 바로 진입하는 임시 코드)
- [ ] 위 두 응답의 `id`/`nickname`/`nationality`/`team`을 `useUserStore`에 저장하는 로직 구현
- [ ] 토큰 만료 시 자동 갱신 처리 — API 클라이언트에서 매 요청 전 `getIdToken()` 호출로 충분 (SDK가 내부적으로 만료 임박 시 자동 갱신)
- [ ] 구글 로그인(`login.tsx`의 `handleGoogleLogin`)은 Firebase JS SDK의 `signInWithPopup`이 RN에서 동작하지 않아 별도 처리 필요 — `expo-auth-session` + `GoogleAuthProvider.credential(...)` 조사 필요
