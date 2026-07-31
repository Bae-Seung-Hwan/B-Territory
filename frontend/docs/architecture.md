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
| `react-native-webview` | 카카오맵 렌더링 |
| `@gorhom/bottom-sheet` | 바텀시트 UI (국가 선택 등) |
| `i18n-iso-countries` | 국가 목록 · 코드 변환 (국적 선택) |
| `@expo/vector-icons` | 탭 아이콘 |
| `i18n-js` + `expo-localization` | 다국어(ko/en), 디바이스 로케일 자동 감지 |

## 프로젝트 구조

```
src/
├── app/
│   ├── _layout.tsx              # Root: QueryClient + AuthProvider + SocketProvider + 전역 오버레이.
│   │                             # RootNavigator가 인증 로딩·조회실패를 먼저 처리하고,
│   │                             # (main)을 Stack.Protected로 감싸 미인증 진입을 라우터에서 차단
│   ├── index.tsx                # useAuth()에 따라 (auth)/(main) 리다이렉트.
│   │                             # 로그인·가입 성공 후에도 이 경로로 replace해 분기를 한 곳에 모은다
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── onboarding.tsx       # 시작 화면
│   │   ├── login.tsx            # 로그인 (이메일/비밀번호, Google)
│   │   └── register.tsx         # 회원가입 (닉네임 · 국적 선택 → 이용약관 동의 → 팀 배정)
│   └── (main)/
│       ├── _layout.tsx          # 5탭 네비게이터
│       ├── spots/                # 관광지 목록 탭 (지도에 표시되는 관광지 리스트, 구 미션 탭) — 플레이스홀더
│       ├── chat/                # 채팅 탭 — 플레이스홀더
│       ├── map/                 # 지도 탭 (홈)
│       ├── ranking/             # 랭킹 탭 — 플레이스홀더
│       └── profile/             # 내정보 탭 — 플레이스홀더
├── api/
│   └── auth.ts                  # registerUser · getMe (axios 기반 API 함수)
├── lib/
│   ├── api-client.ts             # axios 인스턴스 — 요청마다 Firebase ID Token 첨부, 401 시 강제 갱신 후 1회 재시도
│   ├── api-errors.ts
│   ├── firebase.ts               # initializeAuth(app, { persistence: AsyncStorage })
│   ├── firebase-errors.ts
│   ├── query-client.ts
│   └── query-keys.ts             # React Query queryKey factory
├── components/
│   ├── auth/
│   │   └── AppleSignInButton.tsx # iOS 전용, 아직 "준비 중" alert만 뜨는 비활성 버튼 (골격만)
│   ├── ui/                       # Badge · BottomSheet · Button · Card · collapsible (공용 UI)
│   ├── map/
│   │   ├── KakaoMapView.tsx     # WebView + 카카오 JS SDK
│   │   └── MapHUD.tsx           # 상단 HUD (1위팀 · 이번주 수도)
│   └── overlay/
│       ├── EnemyDetectionAlert  # 적 탐지 알림
│       ├── DuelRequest          # 결투 신청 바텀시트
│       └── MiniGame             # 미니게임 전체화면 (플레이스홀더)
├── store/
│   ├── useGameStore.ts          # 점령 구역 · 팀 점수 · 수도. topTeam은 상태로 저장하지 않고
│   │                             # getTopTeam(teamScores) 셀렉터로 매번 계산 (파생 상태 동기화 문제 방지)
│   └── useOverlayStore.ts       # 오버레이 표시 상태
│                                 # (인증·프로필은 스토어에 두지 않는다 — hooks/use-auth.ts 참고)
├── hooks/
│   └── use-auth.ts              # useAuth(): 인증 상태의 단일 소스. Firebase 세션과
│                                 # queryKeys.auth.me 캐시에서 파생시킨다 (스토어 복사본 없음)
├── providers/
│   ├── AuthProvider.tsx         # Firebase 세션만 담당(onAuthStateChanged). 세션이 끊기거나
│   │                             # 계정이 바뀌면 이전 사용자 프로필 캐시를 제거
│   └── SocketProvider.tsx       # Socket.io Context — ⚠️ 연결 시작(connect())·이벤트 배선 미구현,
│                                 #    상세는 integrations.md 참고
├── hooks/
│   ├── use-auth.ts              # 회원가입/로그인 React Query 훅 (useRegisterMutation 등)
│   ├── use-google-login.ts      # expo-auth-session 기반 Google 로그인
│   ├── use-location.ts          # expo-location watchPosition — ⚠️ 아직 어느 화면에서도 호출되지 않음
│   ├── use-theme.ts
│   └── use-color-scheme(.web).ts
├── i18n/                        # ko/en 번역 세트, useTranslation(), 런타임 로케일 전환
├── constants/
│   ├── theme.ts                 # Colors(라이트/다크, Expo 기본 템플릿) +
│   │                             # BrandColors(게임 화면 전용 고정 다크 팔레트: background/surface/border/accent/danger)
│   └── countries.ts             # 회원가입 국적 선택용 국가 목록
└── __tests__/                   # 컴포넌트 · 훅 · lib 단위 테스트 (jest + @testing-library/react-native)
```

`(main)` 탭 4개(`spots`/`chat`/`ranking`/`profile`)는 현재 텍스트만 있는 동일 구조의 플레이스홀더입니다. 실제 기능으로 교체될 예정이라 공용 컴포넌트로 추상화하지 않고 각 파일을 그대로 두었습니다.

## 관련 문서

- 실행 환경 전환 계획: [decisions/0001-expo-go-vs-dev-build.md](./decisions/0001-expo-go-vs-dev-build.md)
- 외부 연동(카카오맵, 소켓, API 키 노출 대응): [integrations.md](./integrations.md)
