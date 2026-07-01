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

## 프로젝트 구조

```
src/
├── app/
│   ├── _layout.tsx              # Root: QueryClient + SocketProvider + 전역 오버레이
│   ├── index.tsx                # 인증 상태에 따라 (auth)/(main) 분기
│   ├── (auth)/
│   │   ├── onboarding.tsx       # 시작 화면
│   │   └── nationality.tsx      # 국적 선택 → 팀 배정
│   └── (main)/
│       ├── _layout.tsx          # 5탭 네비게이터
│       ├── mission/             # 미션 탭
│       ├── chat/                # 채팅 탭
│       ├── map/                 # 지도 탭 (홈)
│       ├── ranking/             # 랭킹 탭
│       └── profile/             # 내정보 탭
├── components/
│   ├── map/
│   │   ├── KakaoMapView.tsx     # WebView + 카카오 JS SDK
│   │   └── MapHUD.tsx           # 상단 HUD (1위팀 · 이번주 수도)
│   └── overlay/
│       ├── EnemyDetectionAlert  # 적 탐지 알림
│       ├── DuelRequest          # 결투 신청 바텀시트
│       └── MiniGame             # 미니게임 전체화면
├── store/
│   ├── useGameStore.ts          # 점령 구역 · 팀 점수 · 수도
│   ├── useUserStore.ts          # 인증 · 국적 · userId
│   └── useOverlayStore.ts       # 오버레이 표시 상태
├── providers/
│   └── SocketProvider.tsx       # Socket.io Context
└── hooks/
    └── use-location.ts          # expo-location watchPosition
```

## 관련 문서

- 실행 환경 전환 계획: [decisions/0001-expo-go-vs-dev-build.md](./decisions/0001-expo-go-vs-dev-build.md)
- 외부 연동(카카오맵, 소켓): [integrations.md](./integrations.md)
