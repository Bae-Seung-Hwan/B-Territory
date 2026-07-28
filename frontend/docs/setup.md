# 셋업 가이드

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

## 타입 체크

```bash
npx tsc --noEmit
```
