# B-Territory Frontend

Expo SDK 56 기반 React Native 앱.

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

## 환경 설정

```bash
cp .env.example .env
```

`.env` 파일에 아래 값을 채웁니다:

```
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_KAKAO_MAP_KEY=<카카오 JavaScript 키>
```

> 카카오 개발자 콘솔 → 플랫폼 → Web → 사이트 도메인에 `http://localhost` 등록 필요

## 실행

```bash
npm install
npx expo start
```

| 단축키 | 동작 |
|--------|------|
| `a` | Android 에뮬레이터 |
| `i` | iOS 시뮬레이터 |
| `w` | 웹 브라우저 |

## Expo Go vs Dev Build

| 기능 | Expo Go | Dev Build |
|------|---------|-----------|
| 화면 UI, 지도(WebView), 소켓 | O | O |
| 백그라운드 GPS 탐지 | X | O |
| 푸시 알림 | X | O |

> 지도·위치 작업 시작 시점에 Dev Build로 전환 예정

## 타입 체크

```bash
npx tsc --noEmit
```
