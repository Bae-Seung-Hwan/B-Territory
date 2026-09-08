# 알려진 결함 · 남은 작업

코드가 지금 어떻게 동작하는지는 각 주제 문서([architecture.md](./architecture.md),
[integrations.md](./integrations.md))가 설명한다. 이 문서는 **아직 해결되지 않은 것들**만
모은다.

> 원래 이 항목들은 세 문서에 흩어진 "필요 작업 (TODO)" 체크박스로 관리했는데, 코드가
> 바뀌어도 체크박스가 따라가지 않아 실제로 어긋났다(구현이 끝난 "이어서 가입"이 미완료로
> 남아 있고, 같은 문서의 다른 절은 "해결됨"이라 적혀 있었다). 한곳에 모아둔 지금 상태도
> 임시방편이고, 제대로 된 자리는 이슈 트래커다.
>
> 그 뒤로도 같은 일이 반복됐다 — 소켓 배선·팀 채팅·구글 로그인이 전부 구현된 뒤에도 이 문서엔
> "통째로 미구현"으로 남아 있었고, 소켓 재연결 항목은 `integrations.md`가 "그렇게 하지 말라"고
> 적어둔 방식(`connect_error`마다 강제 토큰 갱신 + 직접 `connect()`)을 지시하고 있었다.
> **완료된 항목은 지우고, 남은 것만 남긴다** — 완료 표시(`[x]`)로 쌓아두면 다시 같은 상태가 된다.

## 알려진 결함

### Firebase ↔ 백엔드 계정 불일치

Firebase Auth 계정과 백엔드 `users` 테이블 row는 하나의 트랜잭션으로 묶여있지 않아, 둘 중
하나만 존재하는 상태가 생길 수 있다.

**A. Firebase 계정은 있는데 백엔드 프로필이 없음 (가입 중단) — 복구 경로 있음**

- 원인: `use-registration-flow.ts`는 `createUserWithEmailAndPassword`로 Firebase 계정을 만든 뒤
  `POST /api/auth/register`를 호출한다. 백엔드 호출이 동기적으로 실패하면 방금 만든 Firebase
  계정을 롤백(`user.delete()`)하지만, 그 사이 앱이 강제 종료되거나 네트워크가 끊기는 등
  **중단**이 발생하면 롤백이 실행되지 않아 "유령 Firebase 계정"이 남는다.
- 현재 동작: 다음 로그인 시 `getMe()`가 `404` → "이메일/비밀번호를 확인해달라"는 alert가 뜨고
  세션도 정리된 채 로그인 화면에 머무름(`login.tsx`의 `finishLogin`).
- 복구(해결됨): 같은 이메일/비밀번호로 다시 가입을 시도하면 `createUserWithEmailAndPassword`가
  `auth/email-already-in-use`로 실패하는데, 이때 같은 자격증명으로 `signInWithEmailAndPassword`를
  시도한다. 성공하면 본인 계정이므로 계정을 새로 만들지 않고 `POST /api/auth/register`만 이어서
  호출한다(비밀번호가 틀리면 남의 계정이라 여기서 실패하고 그대로 안내된다). 남아있는 세션에
  기대지 않으므로 앱을 재시작한 뒤에도 복구된다. 이 경우는 이번 시도로 만든 계정이 아니므로
  실패 시 롤백 대상에서도 제외된다.

**B. 백엔드 프로필은 있는데 Firebase 계정이 없음 — 미해결, 고착됨**

- 로그인 시도: `signInWithEmailAndPassword`가 즉시 실패(`auth/user-not-found` 또는
  `auth/invalid-credential`) → A와 똑같은 "이메일/비밀번호를 확인해주세요" 메시지가 떠서 진짜
  원인(계정 삭제)을 구분할 방법이 없음.
- 재가입 시도: 같은 이메일로 새 Firebase 계정 생성 자체는 성공하지만, 백엔드 `users.email`에
  `unique: true` 제약이 있어(`backend/src/users/entities/user.entity.ts:16-17`) INSERT가 기존 유령
  row와 충돌 → `409` → 방금 만든 새 Firebase 계정을 다시 롤백. 결과적으로 **로그인도 재가입도
  모두 막힌 상태로 고착**되며, DB에서 유령 row를 수동으로 지우기 전까지는 해당 이메일을 다시
  쓸 수 없다.
- 추가 함정: `FirebaseAuthGuard`가 `verifyIdToken`을 `checkRevoked` 옵션 없이 호출해서
  (`backend/src/common/firebase/firebase.service.ts:24-26`) 서명·만료만 검증하고 계정이 지금도
  존재하는지는 확인하지 않는다. 그래서 계정이 삭제되기 전 이미 발급된 ID Token은 만료 시간
  (최대 1시간)까지는 계속 유효한 것으로 통과된다.

### 생성된 expo-router 타입이 낡으면 `tsc`가 실패한다

`npx tsc --noEmit`이 아래처럼 **실제 코드와 무관한 라우트 타입 에러**로 실패할 수 있다.

```
src/hooks/use-social-auth.ts(72,22): error TS2345:
  Argument of type '"/(auth)/complete-profile"' is not assignable to parameter of type ...
```

`tsconfig.json`이 `include`에 넣는 `.expo/types/router.d.ts`는 expo-router가 **파일 기반 라우트를
훑어 생성**하는 산출물인데, `.expo/`가 `.gitignore` 대상이라 저장소에 없고 dev 서버를 띄우거나
prebuild를 돌릴 때만 갱신된다. 그래서 새 라우트 파일이 추가된 브랜치를 **받아만 놓고 앱을 한 번도
띄우지 않으면**, 낡은 목록에 그 라우트가 없어 `router.replace('/(auth)/complete-profile')` 같은
호출이 타입 에러로 잡힌다.

- 코드 문제가 아니므로 **호출부를 고치지 말 것.** `npx expo start`를 한 번 띄우거나
  `npx expo prebuild -p android`를 돌리면 재생성되면서 사라진다.
- CI(`frontend-ci.yml`)는 이 산출물이 **아예 없는** 상태로 `tsc`를 돌린다(체크아웃 후 생성하는 건
  `expo-env.d.ts`뿐이다). 파일이 없으면 라우트 타입이 느슨해져 같은 코드가 그대로 통과한다 —
  실제로 이 파일만 치우고 돌려보면 클린하다. 즉 **로컬에만 낡은 파일이 남아 있을 때 재현되는
  종류**라, CI 통과와 로컬 실패가 동시에 성립하는 게 정상이다.

## 미해결 설계 질문

### 콜드부트 중 `(main)` 딥링크 진입

앱을 완전히 새로 켰을 때(백그라운드 복귀가 아닌 콜드부트) 푸시 알림 등으로 `(main)` 안의 특정
화면에 직접 딥링크하면, Firebase 세션 복원 → `auth.me` 조회가 끝나기 전까지는 `isAuthenticated`가
`false`라 `Stack.Protected guard={isAuthenticated}`가 그 순간 `(main)`을 네비게이터에서 제외한다.

이 타이밍에 expo-router가 정확히 어떻게 반응하는지(다른 라우트로 리다이렉트되는지, 빈 화면이
잠깐 뜨는지, `auth.me` 완료 후 원래 딥링크 목적지로 결국 도달하는지)는 실기기 딥링크 테스트로
확인되지 않았다.

설령 동작을 확인해도 "이 좁은 엣지케이스(콜드부트 + 딥링크 동시 발생, 보통 1초 미만)에 별도
처리(콜드부트 전용 로딩 게이트로 딥링크 목적지를 붙잡아뒀다가 인증 완료 후 이어서 이동)를 할
가치가 있는지"는 버그가 아니라 제품 판단이 필요한 부분이다. PR #23 3차 리뷰 지적사항 #1
(`_layout.tsx`의 `RootNavigator`가 `(auth)` 화면을 통째로 언마운트시키던 버그) 수정 과정에서
발견했고, 그 버그 자체는 고쳤지만 이 질문은 그대로 남겨뒀다.

라우팅 구조 자체는 [architecture.md의 "라우팅 설계"](./architecture.md#라우팅-설계) 참고.

## 남은 작업

### 결투 · 실시간

연결·이벤트 배선은 완료됐다. 계약과 현재 동작은
[integrations.md의 "실시간 통신"](./integrations.md#실시간-통신-socketio) 참고.

- [ ] `DuelPending`에 취소 수단이 없다 — 백엔드에 `duel:cancel`이 없어 30초 자동 만료에 의존한다.
      취소를 넣으려면 서버 이벤트가 먼저 필요하므로 백엔드 협의 시 함께 논의한다.

### 인증

- [ ] 이메일 인증 e2e 검증 — 실제 기기에서 가입 → 인증 메일 클릭 → 완료까지 한 번도 끝까지
      돌려본 적이 없다(단위 테스트만 있다)
- [ ] 위 "B. 백엔드 프로필은 있는데 Firebase 계정 없음" 복구 — 유령 유저 정리 배치 또는 재가입 시
      안내 개선
- [ ] 위 "콜드부트 중 `(main)` 딥링크 진입" 동작 검증 및 설계 결정

### Apple Sign In

**구현은 끝났고 노출만 막혀 있다.** `AppleSignInButton.tsx`는 `signInAsync` →
`OAuthProvider('apple.com').credential` → 소셜 로그인 공통 후처리까지 실제로 연결돼 있으며
테스트도 있다. 막아둔 이유와 흐름은
[integrations.md의 "Apple Sign In"](./integrations.md#apple-sign-in) 참고.

- [ ] `app.config.js`의 `ios` 블록에 `usesAppleSignIn: true` 추가 — **이게 실제 블로커다.**
      entitlement 없이는 `signInAsync()`가 모든 기기에서 `ERR_REQUEST_NOT_HANDLED`로 실패한다
- [ ] `eas.json` 각 프로필에 iOS 빌드 설정(credentials 등) 추가 — iOS 빌드를 한 번도 돌린 적이 없다
- [ ] Apple Developer 계정에서 Sign in with Apple capability 활성화
- [ ] Firebase 콘솔에서 Apple Provider 활성화
- [ ] iOS 실기기 검증 후 `login.tsx`의 버튼 노출 되돌리기

> ⚠️ **우선순위 주의**: Google 로그인이 이미 켜져 있으므로, App Store 심사 가이드라인 4.8에 따라
> **이 목록을 끝내기 전에는 iOS 제출이 리젝된다.** Android 출시에는 영향이 없다.

### 지도

- [ ] `useGameStore`의 `occupiedDistricts`를 채우는 경로가 없다(세터만 있고 호출부가 없다).
      채워지면 `DistrictPolygons`가 폴백 팔레트 대신 국적/팀별 색상을 쓰게 한다 — 수도 강조가
      이미 같은 방식(자식이 스토어를 직접 구독)으로 붙어 있으므로 그 패턴을 따르면 되고,
      `BusanMapView`에 신규 prop을 추가하는 방향이 아니다
      ([integrations.md](./integrations.md#확장-포인트-점령-시각화--실시간-소켓) 참고)
- [ ] 같은 이유로 `MapHUD`의 "1위팀" 칸이 항상 비어 있다(`teamScores`도 채우는 곳이 없다)

## 정리 대상

기능에 영향은 없지만 남아 있으면 오해를 부르는 것들.

- [ ] **Expo 템플릿 잔여 컴포넌트** — `components/`의 `themed-text` · `themed-view` · `hint-row` ·
      `animated-icon(.web)`(+`animated-icon.module.css`) · `external-link` · `web-badge`와
      `components/ui/collapsible.tsx`. `app/` 어디서도 참조하지 않고 서로만 참조하다 자기
      테스트에서 끝난다. 지우려면 함께 딸린 테스트(`hint-row.test.tsx`·`collapsible.test.tsx`)도
      같이 정리해야 한다
- [ ] **`expo-auth-session` 의존성** — Google 로그인이 네이티브 SDK로 옮겨가면서 실사용처가
      사라졌다. `package.json`에만 남아 있다
