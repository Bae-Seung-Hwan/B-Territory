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

## 빠른 시작

```bash
cp .env.example .env   # 환경변수 채우기 (docs/setup.md 참고)
npm install
npx expo start
```

## 문서

자세한 프로젝트 구조, 환경 설정, 외부 연동, 의사결정 기록은 [docs/](./docs/README.md)를 참고하세요.
