# 외부 연동

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

- `BusanMapView`는 `occupiedDistricts?: Record<string, string>` / `onDistrictPress?: (sigCd: string) => void` prop을 옵셔널로 받는다. 지금은 아무도 값을 넘기지 않아 `src/utils/districtColors.ts#getDistrictFillColor`가 그래프 컬러링 폴백 팔레트만 반환하지만, `useGameStore`의 `occupiedDistricts`가 실제로 채워지면 이 prop에 연결해 국적/팀별 색상으로 교체하면 된다.
- `BusanMapView`는 `useSocket()`이나 어떤 스토어도 직접 구독하지 않는 controlled 컴포넌트로 유지했다. 실시간 플레이어 위치 같은 데이터가 필요해지면 `spots`/`coords`와 동일한 패턴으로 신규 prop을 추가하면 되고, 소켓 배선 자체는 `map/index.tsx`(또는 상위)에서 처리한다.

## 실시간 통신 (Socket.io)

- 구현 위치: `src/providers/SocketProvider.tsx`
- 앱 루트(`src/app/_layout.tsx`)에서 QueryClient와 함께 최상단에 마운트
- `useSocket()`으로 소켓 인스턴스를 꺼내 쓸 수 있는 Context를 제공. `/realtime` 네임스페이스로 접속하며(백엔드 `RealtimeGateway`와 일치), 로그인 상태(`useAuth().isAuthenticated`)를 따라 `connect()`/`disconnect()`가 자동으로 트리거된다 — `auth.currentUser.getIdToken()`으로 매 연결 시도마다 토큰을 새로 읽고, `connect_error` 시 강제 갱신(`getIdToken(true)`) 후 재시도한다
- `encounter:detected`는 Provider 레벨에서 배선돼 있다 — 수신 시 `useOverlayStore.setEnemyInfo(...)` + `setShowEnemyAlert(true)`를 호출해 `EnemyDetectionAlert`를 띄운다(이미 결투 진행 중이면 무시). 페이로드에 정확한 거리값이 없어 `constants/game.ts`의 `ENCOUNTER_RADIUS_M`(100m)을 근사값으로 표시한다
- `useLocation()`(`src/hooks/use-location.ts`)은 지도 화면(`src/app/(main)/map/index.tsx`)에서 좌표가 바뀔 때마다 `location:update`를 emit한다 — 별도 쓰로틀링 없이 `watchPositionAsync`의 `distanceInterval:10m`/`timeInterval:5000ms`에 의존
- `MiniGame`의 `duel:result` emit도 배선됐다(`components/overlay/MiniGame.tsx`) — 승자 판정은 `duelId`로 결정적으로 고른 미니게임(`components/overlay/minigames/`)의 로컬 결과를 보내면, 서버가 양쪽 신고 합의로 확정한다
- 결투 신청/수락/거부/만료/완료/무효 전체 생명주기가 Provider 레벨에 배선돼 있다(`SocketProvider.tsx`):
  - 신청자(challenger)는 `EnemyDetectionAlert`의 "결투 신청"에서 `duel:request`를 emit하고, ack로 받은 `duelId`로 `DuelPending`(응답 대기 화면, 취소 버튼 없음 — 백엔드에 `duel:cancel`이 없어 30초 자동 만료에 맡김)을 띄운다
  - 수신자(recipient)는 `duel:requested` 수신 시 `DuelRequest` 시트가 뜨고, 수락/거부가 각각 `duel:accept`/`duel:reject`를 emit한다(서버 확인 전엔 MiniGame을 열지 않는다)
  - `duel:accepted`는 양쪽 모두에게 와서 `MiniGame`을 연다. `duel:rejected`/`duel:expired`/`duel:completed`/`duel:voided`는 열려있는 오버레이를 `useOverlayStore.resetDuel()`로 정리하고 결과를 `Alert`로 안내한다(`duelId`가 현재 진행 중인 것과 일치할 때만 반응)
- 백엔드(PR #13, `feature/Bae/realtime-duel`)가 제공하는 이벤트: 송신 `location:update`, 수신 `encounter:detected`/`duel:requested`/`duel:accepted`/`duel:rejected`/`duel:completed`/`duel:voided`/`duel:expired`, 송신 `duel:request`/`duel:accept`/`duel:reject`/`duel:result`

### 🔴 알려진 결함 — 미니게임 승패 판정이 거의 항상 무효(VOID) 처리됨

**백엔드 변경 없이는 해결 불가능하며, 결투 기능이 실질적으로 성립하지 않는 상태다.**

세 미니게임(`components/overlay/minigames/`)은 모두 상대 성적과 비교하지 않고 **고정 임계값으로 각자 판정**한다 — `TapBattle` 15탭, `ReactionGame` 350ms, `QuizGame` 정답 여부. 그런데 서버는 두 참가자의 신고가 **정확히 일치할 때만** 결과를 확정하고, 어긋나면 VOID로 처리한다(`redis.service.ts#submitDuelResult`의 Lua: `winners[1] == winners[2]`).

| 상황 | A 신고 | B 신고 | 서버 판정 |
|---|---|---|---|
| 둘 다 임계값 통과 | winner=A | winner=B | conflict → **VOID** |
| 둘 다 임계값 미달 | winner=B | winner=A | conflict → **VOID** |

정확히 한 명만 임계값을 넘는 우연이 아니면 항상 무효가 된다. 특히 `QuizGame`은 정답이 자명해(해운대) 사실상 100% VOID다.

근본 원인은 **두 클라이언트가 서로의 성적을 교환할 채널이 없다**는 것이다. `/realtime`에는 상대에게 임의 데이터를 릴레이하는 이벤트가 없고(`location:update`/`duel:*`뿐), `/chat`(PR #34)은 같은 팀 룸이라 적과는 쓸 수 없다.

해결하려면 백엔드에 점수 릴레이 이벤트(예: `duel:score {duelId, score}` → 상대에게 전달)를 추가하고, 양쪽이 상대 점수를 받아 **비교**한 뒤 같은 `winnerId`를 신고하도록 바꿔야 한다. 백엔드 담당자와 협의 필요.

### 안정성 관련 구현 메모

리뷰에서 드러난 아래 함정들은 수정됐다. 같은 실수를 반복하지 않도록 이유를 남긴다.

- **WS 실패는 ack가 아니라 `exception` 이벤트로 온다.** 서버 핸들러가 throw하면 `emit(..., ack)`의 콜백은 **호출되지 않는다**(`ws-exception.filter.ts` 주석). `SocketProvider`가 `exception`을 구독해 `overlay.duelError.<code>`로 안내하고, `DUEL_*` 코드면 `resetDuel()`로 멈춘 오버레이를 정리한다. 새 emit 지점을 추가할 때 ack만 믿으면 안 된다.
- **"결투 진행 중" 판정은 `useOverlayStore#isDuelBusy` 하나로 통일한다.** `show*` 플래그만 보면, 수락을 emit하고 `duel:accepted`를 기다리는 왕복 구간(오버레이는 없는데 결투는 살아있음)에 새 `duel:requested`가 `duelId`를 덮어써 원래 결투가 id 불일치로 버려진다. 그래서 `duelId != null`도 판정에 포함한다.
- **위치 송신은 조우 탐지 겸 접속 확인이다.** 서버는 `location:update`가 올 때만 `user:meta:*`를 갱신하고 TTL이 120초라, 정지해 있으면(`distanceInterval:10m`) 2분 뒤 오프라인으로 간주돼 `duel:accepted`가 큐로 빠진다. 앱 루트의 `LocationBroadcaster`가 좌표 변경 시 + 60초 주기로 보내며, 특정 탭에 묶지 않는 이유도 이것이다.
- **소켓 토큰은 함수형 `auth`로 넘긴다.** `connect_error`마다 강제 갱신 후 직접 `connect()`를 부르면 socket.io의 지수 백오프를 건너뛰고 Firebase 토큰 갱신을 무한 반복한다. `auth: (cb) => ...`는 매 재연결 시도 직전에 호출되므로 갱신 로직 자체가 필요 없다.
- **소켓 리스너 effect에 `useTranslation()`의 `t`를 넣지 않는다.** 매 렌더 새로 bind되는 함수라 리스너 전체가 렌더마다 재등록된다. 핸들러 안에서는 `i18n.t`를 직접 호출한다.
- **GPS 구독은 `useLocation`이 모듈 스코프에 하나만 유지한다.** 호출한 화면 수만큼 `watchPositionAsync`가 생기지 않도록 공유하며, 마지막 구독자가 사라질 때만 해제한다.

### 필요 작업 (TODO)

- [ ] 위 "🔴 알려진 결함" — 백엔드 점수 릴레이 이벤트 협의 (프론트만으로는 해결 불가)
- [ ] `MiniGame`이 로컬 결과를 먼저 보여주고 "확인"으로 바로 닫을 수 있어, 상대가 결과를 제출하기 전에 닫으면 이후 도착하는 `duel:completed`/`duel:voided`를 못 받는다 — 서버 확정 대기 UI 도입 검토
- [ ] `DuelPending`에 취소 수단이 없다(백엔드에 `duel:cancel`이 없어 30초 만료에 의존) — 백엔드 협의 시 함께 논의

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

### 라우트 가드

`app/_layout.tsx`의 `RootNavigator`가 `(main)` 그룹을 `Stack.Protected guard={isAuthenticated}`로 감싼다. `app/index.tsx`의 리다이렉트는 `"/"`로 들어온 경우에만 동작하므로, 딥링크·웹 URL 직접 입력·푸시 알림처럼 `"/"`를 거치지 않는 진입은 검사를 건너뛰었다.

- `(auth)`는 일부러 가드하지 않는다. 로그인된 사용자가 로그인 화면을 여는 걸 막을 실익이 없고, 가드하면 로그아웃 시 `(auth)`가 열리기 전에 `router.replace`가 나가 이동이 무시된다.
- 반대 방향도 같은 이유로, 로그인·회원가입 성공 후 `(main)`으로 직접 가지 않고 항상 열려있는 `"/"`로 `replace`한다. 인증 상태가 리렌더에 반영되기 전에 가드된 라우트로 이동하면 무시될 수 있어서, 분기 판단을 `index.tsx` 한 곳에 맡긴다.
- ⚠️ **(수정됨) 로그아웃 후 재로그인 시 `(main)` 이동이 조용히 무시되던 버그.** `index.tsx`와 `RootNavigator`가 각각 독립적으로 `useAuth()`를 구독하는데, 두 구독자의 리렌더 커밋 순서가 보장되지 않는다. 앱을 새로 켤 때는 `AuthProvider`가 첫 렌더를 통째로 막고 있다가 한 번에 열어줘서 드러나지 않지만, 로그아웃 후 재로그인처럼 이미 떠 있는 화면들이 각자 리렌더될 때는 `index.tsx`가 `isAuthenticated:true`를 먼저 반영해 `<Redirect>`가 실행되는 순간 `RootNavigator`의 `Stack.Protected` 가드가 아직 `(main)`을 라우터에 등록하기 전일 수 있었다. 이 경우 `router.replace('/(main)/map')`이 존재하지 않는 라우트를 향해 **에러 없이 조용히 무시**되어 `MapScreen`이 아예 마운트되지 않고(콘솔 로그도 전혀 없음) 흰 화면만 남았다. 실기기 로그로 원인을 확정한 뒤, `isAuthenticated=true` 분기를 선언적 `<Redirect>` 대신 `setTimeout(0)`으로 한 틱 미룬 `router.replace`로 바꿔 `RootNavigator`의 가드 갱신이 먼저 커밋되도록 수정했다(`index.tsx`).
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
- [x] 이메일 인증을 Resend 매직링크에서 Firebase 내장(`email_verified`)으로 전환 — 백엔드 PR #26과 함께 머지 필요(위 "이메일 인증 (Firebase 내장)" 섹션 참고). worktree로 PR #26 백엔드를 별도로 띄워 실제 가입→인증→완료 흐름 e2e 확인 필요(아직 미완료)
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
