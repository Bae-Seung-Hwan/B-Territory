# 스토어 출시

`eas.json`은 JSON이라 주석을 달 수 없다. 빌드·제출 설정의 **왜**는 여기 적는다.

## 제출 설정 (`eas.json`의 `submit.production.android`)

| 키 | 값 | 이유 |
|---|---|---|
| `serviceAccountKeyPath` | `./google-play-service-account.json` | Google Play API 업로드 권한. **커밋 금지** — `.gitignore`에 등록돼 있다. 이 파일 하나로 스토어에 앱을 올릴 수 있다 |
| `track` | `internal` | 첫 제출은 내부 테스트로 받는다. 프로덕션 트랙에 바로 올리면 잘못된 빌드를 되돌릴 방법이 사실상 없다 |
| `releaseStatus` | `draft` | 업로드만 하고 배포는 Console에서 사람이 누른다. `eas submit` 한 번이 곧 출시가 되지 않게 한다 |

프로덕션으로 올릴 준비가 되면 `track`을 `production`으로 바꾼다. `releaseStatus`는 그대로 두고 Console에서 배포하는 편이 안전하다.

### `versionCode`는 EAS가 관리한다 (`appVersionSource: "remote"`)

`local`을 쓰지 않는다. `local`은 **소스가 버전의 원본**이라 EAS가 빌드마다 앱 설정 파일에 증가된 값을 되써야 하는데, 이 프로젝트는 정적 `app.json`이 아니라 **동적 `app.config.js`**를 쓴다 — 코드라서 되쓸 수 없다. 게다가 `android.versionCode`가 아예 정의돼 있지도 않다.

그대로 두면 production 빌드가 매번 같은 `versionCode`를 달고 나가, **첫 제출은 통과하고 두 번째 제출이 `Version code 1 has already been used`로 실패한다.** 반복 제출 흐름에서만 드러나는 종류다.

`remote`는 EAS 서버가 `versionCode`를 들고 빌드마다 올려 준다(첫 빌드에서 1로 시작). 이용자에게 보이는 `version`(`1.0.0`)은 그대로 `app.config.js`가 정한다.

### 사전 조건 (`eas submit` 전에 갖춰야 하는 것)

1. Google Play 개발자 계정
2. **Play Console에 앱이 생성돼 있을 것** — 빌드 업로드는 `eas submit`이 하지만, 앱 자체는 미리 만들어져 있어야 한다
3. 서비스 계정 키(아래) 발급 및 EAS 등록
4. `app.config.js`의 `android.package` — 현재 `com.bterritory.app`
5. production 프로필로 빌드한 `.aab`

첫 제출도 `eas submit`으로 가능하다(수동 업로드가 선행될 필요는 없다).

### 서비스 계정 키 발급

1. Google Cloud Console에서 서비스 계정 생성 → JSON 키 다운로드
2. Play Console → 설정 → API 액세스에서 그 서비스 계정을 연결하고 **앱 배포 권한** 부여
3. 받은 JSON을 `frontend/google-play-service-account.json`으로 저장 (커밋되지 않는다)

## 릴리스 빌드 전 확인할 것

### 1. production 환경변수

아래 값들은 **없어도 빌드가 성공하고 실행 시에만 죽는다.** EAS의 production 환경에 전부 등록돼 있는지 확인할 것 — 하나라도 빠지면 심사는 통과하고 실사용에서 기능만 죽는다.

| 변수 | 없으면 | 읽는 곳 |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `http://localhost:3000`으로 떨어져 **아무것도 못 한다** | `lib/api-client.ts` |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | 인증 전체 실패 | `lib/firebase.ts` |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | 〃 | 〃 |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | 〃 | 〃 |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | 〃 | 〃 |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google 로그인 실패 | `hooks/use-google-login.ts` |

`GOOGLE_MAPS_ANDROID_API_KEY`는 `app.config.js`의 `requireEnv`가 fail-fast시켜 **조용히 넘어가지는 않는다.** 다만 그 값은 지금까지 EAS의 **development 환경**에만 등록해 관리해 왔으므로(`app.config.js` 주석 참고), production 환경에 따로 넣기 전까지는 `eas build --profile production`이 config 평가 단계에서 그대로 실패한다.

### 2. 릴리스 서명 SHA-1 등록 — 가장 흔한 사고

**스토어마다 최종 서명 키가 다르다.**

| 배포처 | 최종 서명 |
|---|---|
| Google Play (Play 앱 서명 사용 시) | 업로드한 AAB를 **Google이 재서명** → Play Console → 앱 서명에 표시되는 SHA-1 |
| 원스토어 / 직접 배포 APK | **EAS 키스토어 그대로** → `eas credentials`로 확인 |

두 SHA-1을 **모두** 아래 세 곳에 등록해야 양쪽 배포본에서 로그인·지도가 동작한다.

- Google Cloud Console (네이티브 Google 로그인 OAuth 클라이언트)
- Firebase 콘솔 (Android 앱)
- Maps API 키의 애플리케이션 제한

빠뜨리면 **심사는 통과하는데 실사용에서 로그인만 실패**한다. 개발 빌드에서는 재현되지 않으므로, 릴리스 빌드를 실기기에 설치해 **가입을 끝까지 한 번 통과**시켜 보는 것으로만 확인된다.

### 3. 스토어에 넣을 URL

개인정보처리방침 URL과 계정 삭제 요청 URL은 스토어 필수 입력값이다. 생성기(`scripts/build-legal-pages.mjs`)와 배포 워크플로, 그리고 실제 주소는 **PR #57이 들여온다** — 그 PR이 머지되기 전에는 저장소에 해당 파일도, `docs/compliance.md`의 3.1절도 없다. 머지 후 그 절을 볼 것.

## 절차

```bash
# 1. (최초 1회) Play Console에서 앱을 만들어 둔다 — 빌드 업로드는 아래가 하지만
#    앱 자체는 미리 존재해야 한다. AAB 수동 업로드는 필요 없다.

# 2. 빌드
npx eas build -p android --profile production

# 3. 제출
npx eas submit -p android --profile production
```
