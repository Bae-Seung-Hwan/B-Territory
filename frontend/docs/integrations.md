# 외부 연동

## 카카오맵

- 구현 위치: `src/components/map/KakaoMapView.tsx` (WebView + 카카오 JS SDK)
- HUD: `src/components/map/MapHUD.tsx` (1위팀 · 이번주 수도 표시)
- 필요 환경변수: `EXPO_PUBLIC_KAKAO_MAP_KEY` ([setup.md](./setup.md) 참고)
- 카카오 개발자 콘솔 → 플랫폼 → Web → 사이트 도메인에 사용 도메인 등록 필요

## 실시간 통신 (Socket.io)

- 구현 위치: `src/providers/SocketProvider.tsx`
- 앱 루트(`src/app/_layout.tsx`)에서 QueryClient와 함께 최상단에 마운트
- 오버레이(`useOverlayStore`)와 연동되어 적 탐지 알림, 결투 신청 등 실시간 이벤트를 트리거

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
