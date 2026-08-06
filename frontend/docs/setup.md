# 셋업 가이드

## 환경 설정

```bash
cp .env.example .env
```

`.env` 파일에 아래 값을 채웁니다:

```
EXPO_PUBLIC_API_URL=http://localhost:3000

# Firebase Authentication
EXPO_PUBLIC_FIREBASE_API_KEY=<Firebase 프로젝트 apiKey>
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=<프로젝트>.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=<Firebase project ID>
EXPO_PUBLIC_FIREBASE_APP_ID=<Firebase appId>

# Google 로그인 — Firebase 콘솔에서 Google Provider 활성화 시 자동 발급되는 Web client ID
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<Google OAuth Web client ID>

# Google Maps SDK — react-native-maps용. prebuild 시점에만 읽히므로 EXPO_PUBLIC_ 접두사 없음
GOOGLE_MAPS_ANDROID_API_KEY=<Google Maps Android 키>
GOOGLE_MAPS_IOS_API_KEY=<Google Maps iOS 키>
```

> Firebase/Google 값은 [integrations.md](./integrations.md)의 "Firebase Authentication" 절 참고. `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`가 비어 있으면 로그인 화면의 Google 버튼이 "준비 중" alert로 폴백된다.
> Google Maps 키 발급/제한 방법은 [integrations.md](./integrations.md)의 "Google Maps" 절 참고. 네이티브 모듈이라 Dev Build가 필요하다([decisions/0001-expo-go-vs-dev-build.md](./decisions/0001-expo-go-vs-dev-build.md)).

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

## 트러블슈팅

**`AsyncStorageError: Native module is null, cannot access legacy storage`**

`npm install`은 `package.json`의 semver 범위(`^`)를 그대로 따르므로, Expo SDK가 기대하는
버전과 다른(특히 major가 올라간) 네이티브 모듈이 설치될 수 있다. 아래로 실제 설치된
버전과 SDK 56이 기대하는 버전을 비교해 확인한다.

```bash
npx expo install --check
```

불일치하는 패키지가 나오면(예: `@react-native-async-storage/async-storage`가 기대
버전인 `2.2.0`이 아니라 `3.x`로 설치된 경우) 아래로 맞추고 캐시를 지운 뒤 재시작한다.

```bash
npx expo install @react-native-async-storage/async-storage@2.2.0
npx expo start -c
```
