# 알려진 결함 · 남은 작업

코드가 지금 어떻게 동작하는지는 각 주제 문서([architecture.md](./architecture.md),
[integrations.md](./integrations.md))가 설명한다. 이 문서는 **아직 해결되지 않은 것들**만
모은다.

> 원래 이 항목들은 세 문서에 흩어진 "필요 작업 (TODO)" 체크박스로 관리했는데, 코드가
> 바뀌어도 체크박스가 따라가지 않아 실제로 어긋났다(구현이 끝난 "이어서 가입"이 미완료로
> 남아 있고, 같은 문서의 다른 절은 "해결됨"이라 적혀 있었다). 한곳에 모아둔 지금 상태도
> 임시방편이고, 제대로 된 자리는 이슈 트래커다.

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

### 실시간 통신 (Socket.io)

연결·이벤트 배선이 통째로 미구현이다. 현재 상태는
[integrations.md의 "실시간 통신"](./integrations.md#실시간-통신-socketio) 참고.

- [ ] 소켓 연결 시작 시점 결정(로그인 직후 vs 지도 화면 진입 시) 및 `SocketProvider`에
      `connect()`/재연결·에러 처리 구현
  - **`connect_error` 핸들러는 선택이 아니라 필수다.** 백엔드 인증이 라이프사이클 훅에서
    네임스페이스 미들웨어로 옮겨가면서(PR #34), 인증 실패가 전송 계층 끊김이 아니라
    `CONNECT_ERROR` 패킷으로 온다. socket.io-client는 이 패킷을 받으면 `socket.destroy()`를
    호출해 재접속 구독을 해제하므로 **자동 재접속이 돌지 않는다**(`socket.active === false`).
    Firebase ID 토큰은 1시간 만료라, 만료된 토큰으로 재접속하는 순간 소켓이 영구히 죽는다.
  - 대응: `socket.on('connect_error', ...)`에서 `getIdToken(true)`로 토큰을 갱신해
    `socket.auth.token`에 다시 넣고 `socket.connect()`를 **명시적으로** 호출한다.
    무한 재시도 방지를 위해 백오프·시도 횟수 제한을 함께 둔다.
  - 서버는 거부 사유를 `'unauthorized'` 고정 문구로만 보낸다(내부 에러 노출 방지). 만료
    토큰인지 미가입 유저인지 구분할 수 없으므로, 갱신 후 재시도해도 계속 거부되면 로그인
    화면으로 보내는 흐름이 필요하다.
- [ ] 팀 채팅 배선 — `chat` 탭이 플레이스홀더다. 백엔드는 `/chat` 네임스페이스로 완성돼 있고
      신고·차단 API(`POST /api/reports`, `POST|DELETE /api/blocks/:userId`)도 있다.
      **UGC라 신고·차단 UI가 함께 있어야 Apple 심사(가이드라인 1.2)를 통과한다** —
      `docs/community-policy.md` 참고.
- [ ] `useLocation()`이 지도 화면에서 얻는 좌표를 `location:update`로 보내는 주기/쓰로틀링 결정
      (훅 연결 자체는 완료)
- [ ] `encounter:detected` 등 수신 이벤트를 `useOverlayStore`/`useGameStore`에 연결하는 지점 설계
      (Provider 레벨 일괄 배선 권장 — PR #17 리뷰 코멘트 참고)
- [ ] `DuelRequest`/`MiniGame`의 버튼 액션(`handleAccept` 등)을 실제 `duel:accept`/`duel:result`
      소켓 emit으로 교체

### 인증

- [ ] 구글 로그인 재활성화 — `login.tsx`의 "준비 중" 스텁(`handleGoogleLogin`)을 `useGoogleLogin`
      실제 호출로 되돌리기. Dev Build 전환이 끝나 더 이상 막힌 상태가 아니다
      ([integrations.md](./integrations.md#google-로그인--임시-비활성화) 참고)
- [ ] 이메일 인증 전환 e2e 검증 — worktree로 백엔드 PR #26을 별도로 띄워 실제 가입→인증→완료
      흐름을 한 번도 끝까지 돌려보지 않았다
- [ ] 위 "B. 백엔드 프로필은 있는데 Firebase 계정 없음" 복구 — 유령 유저 정리 배치 또는 재가입 시
      안내 개선
- [ ] 위 "콜드부트 중 `(main)` 딥링크 진입" 동작 검증 및 설계 결정

### Apple Sign In

골격만 있고 `eas.json`의 각 프로필에 iOS 전용 설정(credentials 등)이 없어 iOS 빌드를 한 번도
돌리지 않았다. 아래는 iOS 빌드 파이프라인을 세우는 시점에 함께 진행한다.

- [ ] `eas.json` 각 프로필에 iOS 빌드 설정 추가
- [ ] Apple Developer 계정에서 Sign in with Apple capability 활성화
- [ ] `npx expo install expo-apple-authentication`
- [ ] Firebase 콘솔에서 Apple Provider 활성화
- [ ] `AppleSignInButton`의 stub `onPress`를 `AppleAuthentication.signInAsync(...)` →
      `OAuthProvider('apple.com').credential(...)` → Google과 동일한 프로필 체크/가입 플로우로 교체

### 지도

- [ ] `useGameStore`의 `occupiedDistricts`가 채워지면 `DistrictPolygons`가 그 스토어를 직접
      구독하도록 만들어 폴백 팔레트 대신 국적/팀별 색상으로 교체(`BusanMapView`에 신규 prop을
      추가하는 방향이 아니다) ([integrations.md](./integrations.md#확장-포인트-점령-시각화--실시간-소켓) 참고)
