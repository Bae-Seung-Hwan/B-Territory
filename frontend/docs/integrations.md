# 외부 연동

## 카카오맵

- 구현 위치: `src/components/map/KakaoMapView.tsx` (WebView + 카카오 JS SDK)
- HUD: `src/components/map/MapHUD.tsx` (1위팀 · 이번주 수도 표시)
- 필요 환경변수: `EXPO_PUBLIC_KAKAO_MAP_KEY` ([setup.md](./setup.md) 참고)
- 카카오 개발자 콘솔 → 플랫폼 → Web → 사이트 도메인에 사용 도메인 등록 필요

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

> ⚠️ 2026-07-01 기준 frontend에 Firebase SDK가 아직 설치/연동되어 있지 않음 (구현 예정)

### 인증 흐름

1. **로그인**: Firebase Authentication SDK(이메일/비밀번호, 소셜 로그인 등)로 로그인 → Firebase가 **ID Token** 발급
2. **보관**: 발급받은 ID Token을 클라이언트에서 보관 (예: `useUserStore`)
3. **요청 시 첨부**: 인증이 필요한 API 호출 시 `Authorization: Bearer <idToken>` 헤더로 전송
4. **갱신**: ID Token은 약 1시간 후 만료되므로, Firebase SDK의 갱신 함수로 주기적으로 재발급 필요

### 백엔드와의 관계

- 백엔드는 `FirebaseAuthGuard`로 이 ID Token을 검증하고, 통과 시 `req.user = { uid, email }`을 주입 ([api.txt](./api.txt) 참고)
- 현재 인증이 필요한 API는 `POST /api/auth/register` 하나뿐
- 백엔드 코드에 `JwtStrategy`(자체 발급 JWT)도 존재하지만 어떤 API에도 연결되어 있지 않음 → 프론트는 자체 JWT를 신경 쓸 필요 없이 **Firebase ID Token만** 다루면 됨

### 필요 작업 (TODO)

- [ ] frontend에 Firebase SDK 설치 (Expo 환경이므로 `@react-native-firebase/*` 또는 Firebase JS SDK 중 선택 필요)
- [ ] Firebase 프로젝트 설정값(webApiKey 등) 확보 — 백엔드 `.env`의 `FIREBASE_PROJECT_ID`와 동일한 Firebase 프로젝트 사용
- [ ] 로그인 → ID Token 저장 → API 요청 헤더 첨부까지 이어지는 로직을 `useUserStore` / API 클라이언트에 구현
- [ ] 토큰 만료 시 자동 갱신 처리
