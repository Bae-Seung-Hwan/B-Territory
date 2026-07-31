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

이메일/비밀번호 로그인·가입, Google 로그인(현재 임시 비활성화 — 아래 참고), Apple 로그인 골격까지 구현되어 있음.

### 인증 흐름

1. **로그인**: Firebase Authentication SDK(이메일/비밀번호, 소셜 로그인 등)로 로그인 → Firebase가 **ID Token** 발급
2. **가입 여부 확인**: 로그인 화면에서 로그인 성공 직후, 발급받은 ID Token으로 `GET /api/auth/me` 호출 (`login.tsx:46-60`의 `finishLogin`에서만 호출됨)
   - `200` → 이미 가입된 사용자. 응답 프로필(`id`/`email`/`nickname`/`nationality`/`team`)이 `queryKeys.auth.me` 캐시에 담기고 바로 메인 화면 진입
   - `404` → Firebase 계정은 있지만 백엔드 프로필이 없음. 예전엔 회원가입 화면으로 자동 이동시켰으나, 아래 "⚠️ Firebase ↔ 백엔드 계정 불일치" 문제 때문에 지금은 이메일/비밀번호를 다시 확인해달라는 alert만 띄우고 로그인 화면에 머무름. 이때 `signOut(auth)`으로 세션도 함께 정리해, 프로필 없는 토큰이 이후 요청에 계속 붙거나 다음 부팅 때 어정쩡한 상태로 남지 않게 한다
   - 신규 가입은 이 흐름과 별개로 진행됨: 로그인 화면의 "회원가입 하기" 링크 → 약관 동의 바텀시트 → `register.tsx`에서 `createUserWithEmailAndPassword` 후 `POST /api/auth/register` 호출 (최초 1회만; 재호출 시 `409`)
3. **보관**: ID Token은 Firebase SDK가 AsyncStorage에 보관하고, 프로필은 React Query 캐시(`queryKeys.auth.me`) **한 곳에만** 둔다. 별도 스토어로 복사하지 않는 이유는 아래 "인증 상태의 단일 소스" 참고
4. **요청 시 첨부**: 인증이 필요한 API 호출 시 `Authorization: Bearer <idToken>` 헤더로 전송
5. **갱신**: ID Token은 약 1시간 후 만료되므로, Firebase SDK의 갱신 함수로 주기적으로 재발급 필요

### 인증 상태의 단일 소스

"로그인되어 있는가"는 **Firebase 세션 + `queryKeys.auth.me` 캐시**에서만 파생시킨다. 화면이나 전역 스토어에 `isAuthenticated` 같은 사본을 두지 않는다.

- `providers/AuthProvider.tsx` — Firebase 세션만 담당한다(`onAuthStateChanged`). 세션이 끊기거나 계정이 바뀌면 이전 사용자의 프로필 캐시를 제거한다(로그아웃 버튼을 거치지 않는 세션 만료·토큰 무효화 경로까지 한 곳에서 덮기 위함).
- `hooks/use-auth.ts`의 `useAuth()` — 세션과 프로필 쿼리를 합쳐 `isAuthenticated`/`isLoading`/`isUnavailable`을 계산한다. `getMe`가 `404`만 `null`로 흡수하고 네트워크·5xx는 그대로 던지므로, **미가입(`null`)과 일시적 조회 실패(에러)를 구분**할 수 있다. 후자를 미가입으로 오판하면 정상 가입자가 오프라인 부팅만으로 온보딩으로 되돌아가므로 `app/index.tsx`는 이 경우 재시도 화면을 띄운다.
- 회원가입은 `useRegisterMutation`이 `cancelQueries` → `setQueryData` 순서로 캐시를 채운다. 계정 생성 직후 `AuthProvider`가 감지해 시작한 `getMe`(이 시점엔 프로필이 없어 `404` → `null`)가 등록 성공보다 늦게 끝나면서 방금 받은 프로필을 덮어쓰던 레이스를 막기 위한 것이다.

이전에는 `login.tsx`/`register.tsx`/`AuthProvider`가 각자 `getMe`를 호출해 `useUserStore`에 복사했고, 완료 순서에 따라 서로의 결과를 덮어쓰는 문제가 있었다. 쓰는 곳을 하나로 모아 그 클래스의 버그를 구조적으로 없앴다(`useUserStore`는 이 과정에서 읽는 곳이 없어져 삭제됨).

### 이메일 인증 매직 링크

백엔드 `register()`가 "이 이메일을 방금 인증했는가"를 게이트로 걸기 때문에(`auth.service.ts`), 인증을 거치지 않으면 가입이 `403`으로 거부된다. 프론트 흐름은 다음과 같다.

1. `register.tsx`의 **인증 메일 발송** 버튼 → `POST /api/email/send-link`. 백엔드가 60초 재발송 쿨다운(`429`)을 걸어서, `useSendVerificationLink`가 같은 길이의 카운트다운으로 버튼을 잠근다(최종 판정은 서버).
   - 백엔드는 메일을 **보내기 전에** 락을 먼저 잡는다. 그래서 발송이 실패해 `5xx`가 나도, 또 `429`를 받아도 그 60초 동안 재요청은 무조건 `429`다. 성공에만 쿨다운을 걸면 실패 직후 버튼이 되살아나 헛된 요청과 알럿만 쌓이므로, 이 두 경우에도 잠근다. 반면 `400`(이메일 형식)은 락을 잡기 전에 거부되고 네트워크 오류는 서버 도달 여부를 알 수 없어 잠그지 않는다.
   - 버튼의 `disabled`는 리렌더를 거쳐야 반영돼서 연타하면 그 사이로 press가 빠져나간다. 훅이 진행 중 요청을 ref로 감지해 겹친 호출을 **큐에 쌓지 않고 버리고**, 이때 `sendLink`가 `false`를 돌려줘 호출부가 "보냈습니다" 알럿을 띄우지 않는다.
2. 사용자가 메일의 링크(`${FRONTEND_URL}/verify?token=...`)를 연다 → `app/verify.tsx` → `POST /api/email/verify-token`. 토큰은 **1회용**이라 이 화면은 자동 재시도를 켜지 않고, StrictMode의 이펙트 이중 실행도 ref로 막는다.
3. 검증 성공 시 서버가 `email-verified:<email>` 마커를 30분간 남긴다. **인증 상태는 클라이언트가 아니라 서버에 이메일 기준으로 남으므로**, 링크를 폰 브라우저에서 열고 앱으로 돌아와 가입을 이어가도 인정된다(딥링크 설정이 없어도 동작하는 이유).
4. 인증 없이 가입을 시도하면 `403` → `api-errors.ts`가 "이메일 인증이 필요합니다"로 매핑. 이 경우 백엔드에 아무것도 생기지 않았으므로 `register.tsx`의 롤백 조건에 걸려 방금 만든 Firebase 계정은 삭제된다.

**앱을 종료했다 돌아와도 이어서 가입할 수 있다.** 인증 상태가 서버에 있으므로 가입 자체는 30분 안에 아무 때나 마치면 되고, `canSubmit`도 "이번 실행에서 메일을 보냈는가"를 조건에 넣지 않는다(넣으면 이미 인증한 사용자가 막힌다). 다만 입력값은 컴포넌트 상태라 종료 시 사라지므로, `use-register-draft.ts`가 이메일·닉네임·국적을 AsyncStorage에 임시 보관했다가 복원한다. **비밀번호는 담지 않아** 복원 후 다시 입력해야 하고, 초안은 하루가 지나면 폐기한다(인증 창은 30분이라 그보다 오래된 값이 되살아나는 게 더 혼란스럽다). 초안은 가입이 확정된 뒤에만 삭제한다.

앱은 인증 여부를 알 수 없다 — 백엔드에 상태 조회 엔드포인트가 없고 `verify-token`은 1회용이라서다. 그래서 안내 문구로 "이미 인증을 마쳤다면 메일을 다시 받지 않아도 된다"고 알린다. 메일을 다시 보내도 새 토큰이 발급될 뿐 기존 마커는 유효하다.

⚠️ **백엔드 CORS 필요.** 매직 링크는 브라우저에서 열리므로 `/verify` 화면이 API를 교차 출처로 호출한다. 네이티브 앱만 쓸 때는 CORS가 필요 없어 설정이 없었고, 그 상태에서는 이 기능이 preflight에서 막혀 아예 동작하지 않는다. `backend/src/app-setup.ts`에 `CORS_ORIGINS`(없으면 `FRONTEND_URL`) 기반 `enableCors`를 추가했다. `FRONTEND_URL`은 Expo 웹 개발 서버 포트(기본 8081)와 맞아야 링크가 실제로 열린다.

### 라우트 가드

`app/_layout.tsx`의 `RootNavigator`가 `(main)` 그룹을 `Stack.Protected guard={isAuthenticated}`로 감싼다. `app/index.tsx`의 리다이렉트는 `"/"`로 들어온 경우에만 동작하므로, 딥링크·웹 URL 직접 입력·푸시 알림처럼 `"/"`를 거치지 않는 진입은 검사를 건너뛰었다.

- `(auth)`는 일부러 가드하지 않는다. 로그인된 사용자가 로그인 화면을 여는 걸 막을 실익이 없고, 가드하면 로그아웃 시 `(auth)`가 열리기 전에 `router.replace`가 나가 이동이 무시된다.
- 반대 방향도 같은 이유로, 로그인·회원가입 성공 후 `(main)`으로 직접 가지 않고 항상 열려있는 `"/"`로 `replace`한다. 인증 상태가 리렌더에 반영되기 전에 가드된 라우트로 이동하면 무시될 수 있어서, 분기 판단을 `index.tsx` 한 곳에 맡긴다.
- ⚠️ 웹 정적 렌더링(`expo export --platform web`)은 파일시스템 라우트 전부에 대해 HTML 셸을 생성한다. 가드는 클라이언트 런타임에서 동작하므로 `/map` 같은 URL의 빈 셸 자체는 존재하며, 실제 데이터는 백엔드 `FirebaseAuthGuard`가 막는다.
- ⚠️ **미해결 설계 질문 — 콜드부트 중 `(main)` 딥링크 진입.** 앱을 완전히 새로 켰을 때(백그라운드 복귀가 아닌 콜드부트) 푸시 알림 등으로 `(main)` 안의 특정 화면에 직접 딥링크하면, Firebase 세션 복원 → `auth.me` 조회가 끝나기 전까지는 `isAuthenticated`가 `false`라 `Stack.Protected guard={isAuthenticated}`가 그 순간 `(main)`을 네비게이터에서 제외한다. 이 타이밍에 expo-router가 정확히 어떻게 반응하는지(다른 라우트로 리다이렉트되는지, 빈 화면이 잠깐 뜨는지, `auth.me` 완료 후 원래 딥링크 목적지로 결국 도달하는지)는 실기기 딥링크 테스트로 확인되지 않았다. 설령 동작을 확인해도 "이 좁은 엣지케이스(콜드부트 + 딥링크 동시 발생, 보통 1초 미만)에 별도 처리(콜드부트 전용 로딩 게이트로 딥링크 목적지를 붙잡아뒀다가 인증 완료 후 이어서 이동)를 할 가치가 있는지"는 버그가 아니라 제품 판단이 필요한 부분 — PR #23 3차 리뷰 지적사항 #1(`_layout.tsx`의 `RootNavigator`가 `(auth)` 화면을 통째로 언마운트시키던 버그) 수정 과정에서 발견했고, 그 버그 자체는 고쳤지만 이 질문은 그대로 남겨뒀다.

### 백엔드와의 관계

- 백엔드는 `FirebaseAuthGuard`로 이 ID Token을 검증하고, 통과 시 `req.user = { uid, email }`을 주입 ([backend/docs/API.md](../../backend/docs/API.md) 참고)
- 인증이 필요한 API 2개, 응답 형태 동일(`{ id, email, nickname, nationality, team }`, `team`은 가입 시 `nationality`와 자동 동일하게 설정):
  - `POST /api/auth/register` — 회원가입(최초 1회). Firebase 계정에 이메일이 없으면(전화번호/익명 로그인 등) `400`, 이미 가입된 사용자면 `409`
  - `GET /api/auth/me` — 가입 여부 확인 + 프로필 조회. 로그인 직후 항상 먼저 호출해야 함. 미가입 시 `404`
- 백엔드 코드에 `JwtStrategy`(자체 발급 JWT)도 존재하지만 어떤 API에도 연결되어 있지 않음 → 프론트는 자체 JWT를 신경 쓸 필요 없이 **Firebase ID Token만** 다루면 됨

### ⚠️ Firebase ↔ 백엔드 계정 불일치

Firebase Auth 계정과 백엔드 `users` 테이블 row는 하나의 트랜잭션으로 묶여있지 않아, 둘 중 하나만 존재하는 상태가 생길 수 있고 두 방향 모두 자력으로 복구가 안 되는 막다른 상태로 이어진다.

**A. Firebase 계정은 있는데 백엔드 프로필이 없음 (가입 중단)**
- 원인: `register.tsx`는 `createUserWithEmailAndPassword`로 Firebase 계정을 만든 뒤 `POST /api/auth/register`를 호출하는데, 백엔드 호출이 동기적으로 실패하면 방금 만든 Firebase 계정을 롤백(`user.delete()`)하지만(`register.tsx:97-101`), 그 사이 앱이 강제 종료되거나 네트워크가 끊기는 등 **중단**이 발생하면 이 롤백이 실행되지 않아 "유령 Firebase 계정"이 남는다.
- 현재 동작: 다음 로그인 시 `getMe()`가 `404` → 위에서 설명한 "이메일/비밀번호를 확인해달라"는 alert가 뜨고 세션도 정리된 채 로그인 화면에 머무름 (`login.tsx`의 `finishLogin`).
- 복구 경로(해결됨): `register.tsx`에서 같은 이메일/비밀번호로 다시 가입을 시도하면 `createUserWithEmailAndPassword`가 `auth/email-already-in-use`로 실패하는데, 이때 같은 자격증명으로 `signInWithEmailAndPassword`를 시도한다. 성공하면 본인 계정이므로 계정을 새로 만들지 않고 `POST /api/auth/register`만 이어서 호출한다(비밀번호가 틀리면 남의 계정이라 여기서 실패하고 그대로 안내된다). 남아있는 세션에 기대지 않으므로 앱을 재시작한 뒤에도 복구된다. 이 경우는 이번 시도로 만든 계정이 아니므로 실패 시 롤백(`user.delete()`) 대상에서도 제외된다.

**B. 백엔드 프로필은 있는데 Firebase 계정이 없음 (Firebase 콘솔 등에서 수동 삭제된 경우)**
- 로그인 시도: `signInWithEmailAndPassword`가 즉시 실패(`auth/user-not-found` 또는 `auth/invalid-credential`) → A와 똑같은 "이메일/비밀번호를 확인해주세요" 메시지가 떠서 진짜 원인(계정 삭제)을 구분할 방법이 없음.
- 재가입 시도: 같은 이메일로 새 Firebase 계정 생성 자체는 성공하지만, 백엔드 `users.email`에 `unique: true` 제약이 있어(`backend/src/users/entities/user.entity.ts:16-17`) INSERT가 기존 유령 row와 충돌 → `409` → `register.tsx`가 방금 만든 새 Firebase 계정을 다시 롤백. 결과적으로 **로그인도 재가입도 모두 막힌 상태로 고착**되며, DB에서 유령 row를 수동으로 지우기 전까지는 해당 이메일을 다시 쓸 수 없다.
- 추가 함정: `FirebaseAuthGuard`가 `verifyIdToken`을 `checkRevoked` 옵션 없이 호출해서(`backend/src/common/firebase/firebase.service.ts:24-26`) 서명·만료만 검증하고 계정이 지금도 존재하는지는 확인하지 않는다. 그래서 계정이 삭제되기 전 이미 발급된 ID Token은 만료 시간(최대 1시간)까지는 계속 유효한 것으로 통과된다.
- 개선 방향(TODO): 백엔드에 Firebase 계정이 실제로 존재하는 UID만 남기는 정리 배치, 또는 재가입 시 이메일 충돌을 "관리자 문의" 등으로 더 명확히 안내하는 처리 필요.

### 필요 작업 (TODO)

- [x] frontend에 Firebase SDK 설치 — `firebase`(JS SDK) + `@react-native-async-storage/async-storage`. Expo Go 유지 중이라 네이티브 모듈이 필요 없는 JS SDK를 선택했고, Dev Build 전환 후에도 그대로 사용 가능 ([decisions/0001-expo-go-vs-dev-build.md](./decisions/0001-expo-go-vs-dev-build.md) 참고)
- [x] Firebase 프로젝트 설정값(`apiKey`/`authDomain`/`projectId`/`appId`) — `EXPO_PUBLIC_FIREBASE_*`로 `.env`/`.env.example`에 있음
- [x] `src/lib/firebase.ts` — `initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })`로 세션 유지 설정 완료
- [x] `login.tsx`/`register.tsx` — `signInWithEmailAndPassword`/`createUserWithEmailAndPassword` → ID Token → `src/api/auth.ts`의 `getMe`/`registerUser`(axios 기반, `src/lib/api-client.ts`) 호출 → `queryKeys.auth.me` 캐시 → 라우팅까지 연결됨
- [x] 토큰 만료 시 자동 갱신 — `src/lib/api-client.ts`의 axios 인터셉터가 요청마다 `getIdToken()`을, 401 응답 시 `getIdToken(true)`(강제 갱신) 후 원요청 1회 재시도
- [x] React Query 레이어 — `src/lib/query-keys.ts`(queryKey factory), `src/api/auth.ts`(순수 함수), `src/hooks/use-auth.ts`(`useAuth` · `useRegisterMutation`). `['auth','me']` 캐시가 프로필의 유일한 보관처이고, 로그인 화면만 예외적으로 `queryClient.fetchQuery`로 즉시 결과가 필요한 1회성 조회를 한다(같은 키라 진행 중인 조회가 있으면 합쳐진다)
- [x] 구글 로그인 훅 구현 — `src/hooks/use-google-login.ts`(`expo-auth-session` generic `useAuthRequest` + `GoogleAuthProvider.credential`). **단, 아래 ⚠️ 제약으로 현재 `login.tsx`에서 호출을 막아둔 상태**
- [ ] Dev Build 전환 후 구글 로그인 재활성화 — `login.tsx`의 "준비 중" 스텁(`handleGoogleLogin`)을 `useGoogleLogin` 실제 호출로 되돌리기 (아래 ⚠️ Google 로그인 항목 참고)
- [ ] "Firebase 계정은 있는데 백엔드 프로필 없음" 복구 — `register.tsx`에 "이어서 가입" 모드 추가 (위 ⚠️ A 항목)
- [ ] "백엔드 프로필은 있는데 Firebase 계정 없음" 복구 — 유령 유저 정리 배치 또는 재가입 시 안내 개선 (위 ⚠️ B 항목)
- [ ] 콜드부트 중 `(main)` 딥링크 진입 시 동작 검증 및 설계 결정 (위 라우트 가드 섹션의 ⚠️ 미해결 설계 질문 참고)

### ⚠️ Google 로그인 — 임시 비활성화 (Expo Go 실기기 제약)

Google의 OAuth "Web" 클라이언트는 redirect URI로 `http`/`https`만 허용해 커스텀 스킴(`exp://...`)을 거부한다. 따라서 Expo Go 앱으로 실기기/시뮬레이터에서 실행하면 `AuthSession.makeRedirectUri({ scheme: 'b-territory' })`가 `exp://...` 형태가 되어 Google이 `redirect_uri_mismatch`로 거부하는 게 **정상 동작**이다. 예전에 이를 우회하던 Expo `auth.expo.io` 프록시는 최신 `expo-auth-session`에서 제거됐다.

문제는 여기서 그치지 않는다: 실기기(Expo Go)에서 이 mismatch 에러 화면을 X로 닫으면 Auth Session이 비정상 종료되면서 **Expo Go 앱 자체가 꺼지는 문제**가 확인되어, 지금은 `login.tsx`의 구글 로그인 버튼을 Apple 로그인과 동일하게 "준비 중" alert만 띄우는 스텁으로 임시 전환해뒀다(`handleGoogleLogin`). `useGoogleLogin` 훅(`src/hooks/use-google-login.ts`) 구현 자체는 남아있지만 `login.tsx`에서 더 이상 호출하지 않는다.

- **지금 검증 가능한 방법**: `npm run web`(`expo start --web`) — redirect URI가 `http://localhost:...`가 되어 Google이 허용. 단 실기기 버튼은 스텁 상태라 알럿만 뜨므로, 실제 로그인을 확인하려면 웹에서 `login.tsx`에 `useGoogleLogin` 호출을 임시로 되돌려야 함
- **재활성화 시점**: Dev Build 전환 후 네이티브 `@react-native-google-signin/google-signin`으로 교체하면서 `login.tsx`의 스텁을 실제 훅 호출로 되돌릴 예정 ([decisions/0001-expo-go-vs-dev-build.md](./decisions/0001-expo-go-vs-dev-build.md) 참고)
- **설정 필요(재활성화 시)**: Firebase 콘솔 → Authentication → Sign-in method → Google 활성화 시 자동 발급되는 **Web client ID**를 `.env`의 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`에 채워야 함(콘솔 접근 권한이 있는 사람이 직접)

## Apple Sign In

> ⚠️ 골격만 구현됨 — `src/components/auth/AppleSignInButton.tsx`는 iOS에서만 렌더링되고, 탭하면 "준비 중" alert만 뜨는 비활성 버튼. App Store 심사 Guideline 4.8(소셜 로그인 제공 시 Apple 로그인도 필수)에 대비한 자리만 마련해둔 상태.

네이티브 모듈(`expo-apple-authentication`)이 필요한데 Dev Build가 있어야 하고, 지금 프로젝트는 아직 Expo Go 단계라 `app.json`에 iOS bundle identifier도 없다 ([decisions/0001-expo-go-vs-dev-build.md](./decisions/0001-expo-go-vs-dev-build.md)가 정한 전환 시점은 GPS 작업 시작 시점).

### 필요 작업 (TODO, Dev Build 전환 이후)

- [ ] `app.json`에 `ios.bundleIdentifier` 설정 (Dev Build 전환의 일부)
- [ ] Apple Developer 계정에서 Sign in with Apple capability 활성화
- [ ] `npx expo install expo-apple-authentication`
- [ ] Firebase 콘솔에서 Apple Provider 활성화
- [ ] `AppleSignInButton`의 stub `onPress`를 `AppleAuthentication.signInAsync(...)` → `OAuthProvider('apple.com').credential(...)` → Google과 동일한 프로필 체크/가입 플로우로 교체
