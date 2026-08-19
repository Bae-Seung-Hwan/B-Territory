# 아키텍처 / 설계

## 기술 스택

| 패키지 | 용도 |
|--------|------|
| `expo-router` | 파일 기반 라우팅 |
| `zustand` | 전역 상태 관리 |
| `@tanstack/react-query` | 서버 상태 캐싱 |
| `axios` | HTTP 클라이언트 (백엔드 API 요청) |
| `firebase` | Authentication (이메일/비밀번호, Google, Apple 골격) |
| `expo-auth-session` | Google OAuth 로그인 흐름 |
| `@react-native-async-storage/async-storage` | Firebase Auth 세션 영속화 |
| `socket.io-client` | 실시간 WebSocket |
| `expo-location` | GPS 위치 추적 |
| `react-native-maps` | Google Maps 렌더링(네이티브, Dev Build 필요) |
| `react-native-svg` | 커스텀 마커 아이콘 |
| `react-native-reanimated` | 현재 위치 pulse 마커 등 애니메이션 |
| `@gorhom/bottom-sheet` | 바텀시트 UI (국가 선택 등) |
| `i18n-iso-countries` | 국가 목록 · 코드 변환 (국적 선택) |
| `@expo/vector-icons` | 탭 아이콘 |
| `i18n-js` + `expo-localization` | 다국어(ko/en), 디바이스 로케일 자동 감지 |

## 프로젝트 구조

`src/` 아래 디렉터리별 역할이다. 파일 목록은 `find src`가 항상 정확하므로 여기서는
**디렉터리의 책임과, 코드만 봐서는 알기 어려운 결정**만 적는다.

| 디렉터리 | 책임 |
|---|---|
| `app/` | expo-router 파일 기반 라우트. `(auth)`/`(main)` 두 그룹과 루트 레이아웃 |
| `api/` | axios 기반 순수 API 함수 (`auth` · `spots` · `districts` · `claims`) |
| `lib/` | 앱 전역 인프라 — axios 인스턴스, Firebase 초기화, React Query 클라이언트/키 팩토리, 에러 매핑 |
| `hooks/` | 화면이 쓰는 로직 단위. 인증·가입 상태기계·위치·점령 시도 |
| `providers/` | Context 두 개 — Firebase 세션(`AuthProvider`), 소켓(`SocketProvider`) |
| `components/` | `ui/`(공용) · `map/`(지도 조립) · `overlay/`(전역 오버레이) · `auth/` |
| `store/` | zustand. 게임 상태와 오버레이 표시 상태 **둘뿐** |
| `constants/` | 좌표·코드표·카테고리·미션 정의 등 하드코딩 데이터의 단일 소스 |
| `utils/` | 순수 계산 — 좌표/거리, 줌 임계, 폴리곤 색 배정 |
| `i18n/` | ko/en 번역 세트, `useTranslation()`, 런타임 로케일 전환 |
| `__tests__/` | jest + @testing-library/react-native |

### 화면 구성

`(main)`은 5탭이고, 이 중 **`map`만 기능이 들어가 있다.** `profile`은 프로필 카드와 로그아웃까지
있고, 나머지 3개(`spots` · `chat` · `ranking`)는 텍스트만 있는 동일 구조의 플레이스홀더다. 실제
기능으로 교체될 예정이라 공용 컴포넌트로 추상화하지 않고 각 파일을 그대로 두었다.

`(auth)`는 `onboarding` · `login` · `register` 3개다. `register.tsx`는 렌더링만 담당하고 가입
상태기계는 `hooks/use-registration-flow.ts`에 있다 —
[integrations.md의 "이메일 인증"](./integrations.md#이메일-인증-firebase-내장) 참고.

### 코드만 봐서는 알기 어려운 것들

- **`store/useGameStore.ts`의 `topTeam`은 상태로 저장하지 않는다.** `getTopTeam(teamScores)`
  셀렉터로 매번 계산한다. 파생 상태를 따로 들고 있으면 원본과 어긋나는 순간이 생긴다.
- **인증·프로필은 스토어에 두지 않는다.** 아래 "상태 관리 설계" 참고.
- **`lib/api-client.ts`** — 요청마다 Firebase ID Token을 붙이고, `401`이면 `getIdToken(true)`로
  강제 갱신한 뒤 원요청을 **1회만** 재시도한다.
- **`lib/register-draft.ts`** — 가입 초안을 AsyncStorage에 보관(최대 24시간). 이메일 인증 링크를
  누르러 나갔다가 앱이 꺼져도 닉네임/국적을 다시 입력하지 않게 하려는 것이다. 비밀번호는 담지
  않으므로 복원 후 다시 입력해야 한다.
- **`components/map/BusanMapView.tsx`는 controlled 컴포넌트다.** `useSocket()`이나 스토어를 직접
  구독하지 않고 prop만 받는다 —
  [integrations.md의 "확장 포인트"](./integrations.md#확장-포인트-점령-시각화--실시간-소켓) 참고.
- **`constants/busan.ts`** — 지도 드래그 제한과 "현재 위치가 부산 범위 밖인지" 판정이 같은 좌표
  기준을 써야 하므로 단일 소스로 둔다.
- **`constants/theme.ts`는 팔레트를 두 벌 들고 있다.** `Colors`는 Expo 기본 템플릿의 라이트/다크
  세트이고, `BrandColors`는 게임 화면 전용으로 고정된 다크 팔레트다
  (`background`/`surface`/`border`/`accent`/`danger`). 게임 화면은 시스템 테마를 따르지 않는다.
- **`constants/mapCategories.ts`** — TourAPI `contenttypeid`별 마커 설정. 마커 아이콘, 필터 패널,
  줌 기반 자동 숨김이 **모두 이 표 하나를 참조**하므로 카테고리 동작을 바꿀 땐 여기만 고치면 된다.
- **`utils/districtColors.ts`** — 실제 인접 그래프를 4색 정리로 칠해서 맞닿은 구끼리 절대 같은
  색이 되지 않게 한다. 점령 상태가 붙기 전까지 쓰는 폴백 팔레트다.
- **`utils/geo.ts`** — 위도 1도가 어디서든 약 111.32km인 점을 이용해 `latitudeDelta`를 미터로
  환산한다. 경도는 위도에 따라 실거리가 달라지지만 부산처럼 좁은 범위(34.8~35.4°N)에서는 위도
  기준 근사로 충분하다.
- **`components/` 루트의 `themed-text` · `themed-view` · `hint-row` · `animated-icon(.web)` ·
  `external-link` · `web-badge`** 는 Expo 템플릿에서 딸려온 공용 요소다.

## 상태 관리 설계

### 인증 상태의 단일 소스

"로그인되어 있는가"는 **Firebase 세션 + `queryKeys.auth.me` 캐시**에서만 파생시킨다. 화면이나
전역 스토어에 `isAuthenticated` 같은 사본을 두지 않는다.

- `providers/AuthProvider.tsx` — Firebase 세션만 담당한다(`onAuthStateChanged`). 세션이 끊기거나
  계정이 바뀌면 이전 사용자의 프로필 캐시를 제거한다(로그아웃 버튼을 거치지 않는 세션 만료·토큰
  무효화 경로까지 한 곳에서 덮기 위함).
- `hooks/use-auth.ts`의 `useAuth()` — 세션과 프로필 쿼리를 합쳐
  `isAuthenticated`/`isLoading`/`isUnavailable`을 계산한다. `getMe`가 `404`만 `null`로 흡수하고
  네트워크·5xx는 그대로 던지므로, **미가입(`null`)과 일시적 조회 실패(에러)를 구분**할 수 있다.
  후자를 미가입으로 오판하면 정상 가입자가 오프라인 부팅만으로 온보딩으로 되돌아가므로
  `app/index.tsx`는 이 경우 재시도 화면을 띄운다.
- 회원가입은 `useRegisterMutation`이 `cancelQueries` → `setQueryData` 순서로 캐시를 채운다. 계정
  생성 직후 `AuthProvider`가 감지해 시작한 `getMe`(이 시점엔 프로필이 없어 `404` → `null`)가 등록
  성공보다 늦게 끝나면서 방금 받은 프로필을 덮어쓰던 레이스를 막기 위한 것이다.
- `['auth','me']` 캐시가 프로필의 유일한 보관처다. 로그인 화면만 예외적으로
  `queryClient.fetchQuery`로 즉시 결과가 필요한 1회성 조회를 한다(같은 키라 진행 중인 조회가
  있으면 합쳐진다).

이전에는 `login.tsx`/`register.tsx`/`AuthProvider`가 각자 `getMe`를 호출해 `useUserStore`에
복사했고, 완료 순서에 따라 서로의 결과를 덮어쓰는 문제가 있었다. 쓰는 곳을 하나로 모아 그
클래스의 버그를 구조적으로 없앴다(`useUserStore`는 이 과정에서 읽는 곳이 없어져 삭제됨).

## 라우팅 설계

### 라우트 가드

`app/_layout.tsx`의 `RootNavigator`가 `(main)` 그룹을 `Stack.Protected guard={isAuthenticated}`로
감싼다. `app/index.tsx`의 리다이렉트는 `"/"`로 들어온 경우에만 동작하므로, 딥링크·웹 URL 직접
입력·푸시 알림처럼 `"/"`를 거치지 않는 진입은 검사를 건너뛰었다.

- `(auth)`는 일부러 가드하지 않는다. 로그인된 사용자가 로그인 화면을 여는 걸 막을 실익이 없고,
  가드하면 로그아웃 시 `(auth)`가 열리기 전에 `router.replace`가 나가 이동이 무시된다.
- 반대 방향도 같은 이유로, 로그인·회원가입 성공 후 `(main)`으로 직접 가지 않고 항상 열려있는
  `"/"`로 `replace`한다. 인증 상태가 리렌더에 반영되기 전에 가드된 라우트로 이동하면 무시될 수
  있어서, 분기 판단을 `index.tsx` 한 곳에 맡긴다.
- 웹 정적 렌더링(`expo export --platform web`)은 파일시스템 라우트 전부에 대해 HTML 셸을 생성한다.
  가드는 클라이언트 런타임에서 동작하므로 `/map` 같은 URL의 빈 셸 자체는 존재하며, 실제 데이터는
  백엔드 `FirebaseAuthGuard`가 막는다.

### `index.tsx`가 `<Redirect>` 대신 `setTimeout(0)`을 쓰는 이유

로그아웃 후 재로그인 시 `(main)` 이동이 조용히 무시되던 버그를 고친 흔적이다. 되돌리면 재발한다.

`index.tsx`와 `RootNavigator`가 각각 독립적으로 `useAuth()`를 구독하는데, 두 구독자의 리렌더 커밋
순서가 보장되지 않는다. 앱을 새로 켤 때는 `AuthProvider`가 첫 렌더를 통째로 막고 있다가 한 번에
열어줘서 드러나지 않지만, 로그아웃 후 재로그인처럼 이미 떠 있는 화면들이 각자 리렌더될 때는
`index.tsx`가 `isAuthenticated:true`를 먼저 반영해 `<Redirect>`가 실행되는 순간 `RootNavigator`의
`Stack.Protected` 가드가 아직 `(main)`을 라우터에 등록하기 전일 수 있었다. 이 경우
`router.replace('/(main)/map')`이 존재하지 않는 라우트를 향해 **에러 없이 조용히 무시**되어
`MapScreen`이 아예 마운트되지 않고(콘솔 로그도 전혀 없음) 흰 화면만 남았다.

실기기 로그로 원인을 확정한 뒤, `isAuthenticated=true` 분기를 선언적 `<Redirect>` 대신
`setTimeout(0)`으로 한 틱 미룬 `router.replace`로 바꿔 `RootNavigator`의 가드 갱신이 먼저
커밋되도록 수정했다.

> 콜드부트 중 딥링크로 `(main)`에 직접 진입할 때의 동작은 아직 확인되지 않았다 —
> [known-issues.md](./known-issues.md#콜드부트-중-main-딥링크-진입) 참고.

## 관련 문서

- 외부 연동(Google Maps, 소켓, Firebase Auth, Apple): [integrations.md](./integrations.md)
- 알려진 결함 · 남은 작업: [known-issues.md](./known-issues.md)
- 실행 환경 전환(Expo Go → Dev Build, 완료): [decisions/0001-expo-go-vs-dev-build.md](./decisions/0001-expo-go-vs-dev-build.md)
- 점령 미션 확장성(프론트엔드만): [decisions/0002-claim-mission-extensibility.md](./decisions/0002-claim-mission-extensibility.md)
