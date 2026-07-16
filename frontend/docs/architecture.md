# 아키텍처 / 설계

## 기술 스택

| 패키지 | 용도 |
|--------|------|
| `expo-router` | 파일 기반 라우팅 |
| `zustand` | 전역 상태 관리 |
| `@tanstack/react-query` | 서버 상태 캐싱 |
| `socket.io-client` | 실시간 WebSocket |
| `expo-location` | GPS 위치 추적 |
| `react-native-webview` | 카카오맵 렌더링 |
| `@expo/vector-icons` | 탭 아이콘 |
| `i18n-js` + `expo-localization` | 다국어(ko/en), 디바이스 로케일 자동 감지 |

## 프로젝트 구조

```
src/
├── app/
│   ├── _layout.tsx              # Root: QueryClient + SocketProvider + 전역 오버레이
│   ├── index.tsx                # 인증 상태(useUserStore.isAuthenticated)에 따라 (auth)/(main) 리다이렉트
│   ├── (auth)/
│   │   ├── onboarding.tsx       # 시작 화면
│   │   ├── login.tsx            # 로그인
│   │   └── register.tsx         # 회원가입 (닉네임 · 국적 선택 → 팀 배정)
│   └── (main)/
│       ├── _layout.tsx          # 5탭 네비게이터
│       ├── spots/                # 관광지 목록 탭 (지도에 표시되는 관광지 리스트, 구 미션 탭)
│       ├── chat/                # 채팅 탭 — 플레이스홀더
│       ├── map/                 # 지도 탭 (홈)
│       ├── ranking/             # 랭킹 탭 — 플레이스홀더
│       └── profile/             # 내정보 탭 — 플레이스홀더
├── components/
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
│   ├── useUserStore.ts          # 인증 · 국적 · 닉네임 · userId
│   └── useOverlayStore.ts       # 오버레이 표시 상태
├── providers/
│   └── SocketProvider.tsx       # Socket.io Context — ⚠️ 연결 시작(connect())·이벤트 배선 미구현,
│                                 #    상세는 integrations.md 참고
├── hooks/
│   └── use-location.ts          # expo-location watchPosition — ⚠️ 아직 어느 화면에서도 호출되지 않음
├── i18n/                        # ko/en 번역 세트, useTranslation(), 런타임 로케일 전환
└── constants/
    └── theme.ts                 # Colors(라이트/다크, Expo 기본 템플릿) +
                                  # BrandColors(게임 화면 전용 고정 다크 팔레트: background/surface/border/accent/danger)
```

`(main)` 탭 4개(`spots`/`chat`/`ranking`/`profile`)는 현재 텍스트만 있는 동일 구조의 플레이스홀더입니다. 실제 기능으로 교체될 예정이라 공용 컴포넌트로 추상화하지 않고 각 파일을 그대로 두었습니다.

## 관련 문서

- 실행 환경 전환 계획: [decisions/0001-expo-go-vs-dev-build.md](./decisions/0001-expo-go-vs-dev-build.md)
- 외부 연동(카카오맵, 소켓, API 키 노출 대응): [integrations.md](./integrations.md)
