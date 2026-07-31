# 셋업 가이드

## 환경 설정

```bash
cp .env.example .env
```

`.env` 파일에 아래 값을 채웁니다:

```
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_KAKAO_MAP_KEY=<카카오 JavaScript 키>

# Firebase Authentication
EXPO_PUBLIC_FIREBASE_API_KEY=<Firebase 프로젝트 apiKey>
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=<프로젝트>.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=<Firebase project ID>
EXPO_PUBLIC_FIREBASE_APP_ID=<Firebase appId>

# Google 로그인 — Firebase 콘솔에서 Google Provider 활성화 시 자동 발급되는 Web client ID
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<Google OAuth Web client ID>
```

> 카카오 개발자 콘솔 → 플랫폼 → Web → 사이트 도메인에 `http://localhost` 등록 필요
> Firebase/Google 값은 [integrations.md](./integrations.md)의 "Firebase Authentication" 절 참고. `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`가 비어 있으면 로그인 화면의 Google 버튼이 "준비 중" alert로 폴백된다.

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

## 타입 체크

```bash
npx tsc --noEmit
```
