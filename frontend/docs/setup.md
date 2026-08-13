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

> `a`/`i`로 앱을 띄우려면 기기에 **Dev Build가 설치돼 있어야 한다**. `react-native-maps` 같은
> 네이티브 모듈 때문에 Expo Go로는 실행되지 않는다([decisions/0001](./decisions/0001-expo-go-vs-dev-build.md)).
> 설치가 안 돼 있다면 아래 "Android Dev Build" 절을 먼저 진행한다.

## Android Dev Build

APK를 한 번 만들어 기기/에뮬레이터에 설치하면, 그 뒤로는 `npx expo start --dev-client`로
JS만 리로드하며 개발한다. **네이티브 의존성이 바뀔 때만** 다시 빌드하면 된다.

### 방법 A. EAS 클라우드 빌드 (로컬 Android SDK 불필요)

```bash
npx eas-cli login
npx eas-cli build --profile development --platform android
```

빌드가 끝나면 APK를 받아 설치한다.

```bash
adb install <내려받은>.apk
npx expo start --dev-client
```

로컬에 SDK/JDK를 갖출 필요가 없지만, 네이티브 변경마다 클라우드 빌드를 기다려야 한다.
`GOOGLE_MAPS_ANDROID_API_KEY`는 로컬 `.env`가 아니라 EAS 환경변수(`development`)에서 읽힌다.

### 방법 B. 로컬 빌드

```bash
npx expo run:android          # prebuild + Gradle 빌드 + 설치 + 실행
```

`package.json`의 `npm run android`도 동일한 명령이다(`ios`도 마찬가지로 `expo run:ios`). 다만
`npm run ios`는 `eas.json`에 iOS 프로필이 없어 로컬 Xcode 빌드를 시도하게 되는데 아직 한 번도
성공시킨 적이 없다 — [known-issues.md](./known-issues.md#apple-sign-in) 참고.

필요한 도구는 다음과 같다. **버전이 어긋나면 대부분 아래 트러블슈팅의 증상으로 나타난다.**

| 구성요소 | 버전 | 비고 |
|----------|------|------|
| JDK | **17** | `react-native`가 `jvmToolchain(17)`을 요구. JRE가 아닌 full JDK여야 한다 |
| Android SDK Platform | `android-36` | |
| Build-Tools | `36.0.0` | |
| NDK | `28.2.13676358` | `react-native-reanimated`가 C++를 소스 빌드 |
| CMake | `3.22.1` | 〃 |
| Gradle | `9.3.1` | `android/`의 wrapper가 자동 사용 |

### WSL2에서 Windows 에뮬레이터로 빌드하기

WSL2에서 개발하고 에뮬레이터는 Windows에서 띄우는 구성. **`.wslconfig`에
`networkingMode=mirrored`가 켜져 있어야 한다** — 그래야 WSL의 adb가 Windows 에뮬레이터를
자동 인식하고, 에뮬레이터가 WSL의 Metro(8081)에 접근할 수 있다.

```ini
# C:\Users\<사용자>\.wslconfig
[wsl2]
networkingMode=mirrored
```

**Windows SDK를 그대로 쓰면 안 된다.** `/mnt/c/.../Android/Sdk` 안의 빌드 도구는
`aapt2.exe`, `d8.bat` 같은 Windows 실행 파일이라 리눅스 Gradle이 실행할 수 없다.
WSL 안에 **Linux용 SDK를 따로** 설치한다.

```bash
# 1) Linux용 command line tools — https://developer.android.com/studio#command-line-tools-only
mkdir -p ~/Android/Sdk/cmdline-tools
unzip commandlinetools-linux-*.zip -d ~/Android/Sdk/cmdline-tools
mv ~/Android/Sdk/cmdline-tools/cmdline-tools ~/Android/Sdk/cmdline-tools/latest

# 2) SDK 패키지
export ANDROID_HOME=$HOME/Android/Sdk
yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager \
  "platform-tools" "platforms;android-36" "build-tools;36.0.0" \
  "ndk;28.2.13676358" "cmake;3.22.1"

# 3) JDK 17 (apt로 설치해도 되고, 아래는 sudo 없이 받는 방법)
mkdir -p ~/.jdks
curl -sL "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse" \
  | tar -xz -C ~/.jdks
```

`~/.bashrc`에 등록한다.

```bash
export JAVA_HOME=$HOME/.jdks/jdk-17.0.20+8   # 실제 설치된 디렉터리명으로
export ANDROID_HOME=$HOME/Android/Sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH
```

> Windows `adb.exe`를 `alias adb="adb.exe"`나 심볼릭 링크로 쓰고 있었다면 **제거한다.**
> Windows adb는 리눅스 경로(`/home/...`)를 못 읽어서 APK 설치 단계에서 실패한다.
> `platform-tools`를 PATH 앞에 두면 리눅스 adb가 우선한다.

에뮬레이터는 Windows(Android Studio 또는 `emulator.exe`)에서 띄운다. 미러드 네트워킹이면
WSL의 adb가 `emulator-5554`로 **자동 인식**하므로 `adb connect`는 필요 없다.

```bash
adb devices                   # emulator-5554  device 로 보이면 준비 완료
npx expo run:android
```

빌드 후 앱이 Metro에 못 붙으면 포트를 넘겨준다.

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:3000 tcp:3000   # 백엔드를 WSL에서 띄운 경우
```

## 타입 체크

```bash
npx tsc --noEmit
```

## 트러블슈팅

### 의존성

**`AsyncStorageError: Native module is null, cannot access legacy storage`**

`npm install`은 `package.json`의 semver 범위(`^`)를 그대로 따르므로, Expo SDK가 기대하는
버전과 다른(특히 major가 올라간) 네이티브 모듈이 설치될 수 있다. 아래로 실제 설치된
버전과 SDK 56이 기대하는 버전을 비교해 확인한다.

```bash
npx expo install --check
```

불일치하는 패키지가 나오면 아래처럼 `npx expo install <패키지>@<기대 버전>`으로 맞추고 캐시를
지운 뒤 재시작한다. (`@react-native-async-storage/async-storage`는 `package.json`에 `^` 없이
`2.2.0`으로 정확히 고정해둬서 이 패키지 자체는 지금 이 드리프트가 나지 않는다. 아래는 형태만
보여주는 예시다.)

```bash
npx expo install @react-native-async-storage/async-storage@2.2.0
npx expo start -c
```

### Android 빌드

**`Toolchain installation '...' does not provide the required capabilities: [JAVA_COMPILER]`**

해당 JVM이 JRE라 `javac`가 없다. `java -version`은 정상 출력되므로 눈치채기 어렵다.
`ls $JAVA_HOME/bin/javac`로 확인하고, full JDK 17을 설치해 `JAVA_HOME`을 옮긴다.
Gradle에 직접 못 박으려면 `~/.gradle/gradle.properties`에 적는다.

```properties
org.gradle.java.home=/절대/경로/jdk-17
org.gradle.java.installations.paths=/절대/경로/jdk-17
```

**`NoSuchFieldError: JvmVendorSpec.IBM_SEMERU` / `Could not initialize class org.gradle.toolchains.foojay.DistributionsKt`**

JDK 17이 없어서 Gradle이 자동으로 내려받으려 할 때 발생한다. 이때 호출되는
`foojay-resolver` 0.5.0이 Gradle 9와 호환되지 않는다. **자동 다운로드를 고치는 게 아니라
JDK 17을 직접 설치해서 자동 다운로드가 일어나지 않게 하는 것이 해결책**이다.

**`Unresolved reference 'extensions' / 'extra' / 'logger'` (expo-autolinking-settings-plugin)**

Gradle 버전이 낮아 Expo 오토링킹 플러그인이 최신 Gradle API를 못 찾는 경우다.
래퍼 버전을 확인한다.

```bash
grep distributionUrl android/gradle/wrapper/gradle-wrapper.properties
```

`android/`는 `.gitignore` 대상인 prebuild 생성물이므로, 값이 다르면 손으로 고치기보다
템플릿에서 재생성하는 편이 안전하다. 다른 항목까지 함께 어긋나 있을 수 있다.

```bash
npx expo prebuild --clean -p android
```

**`CommandError: Could not find device with name: emulator-5554`**

`--device`는 adb 시리얼이 아니라 **AVD 이름**을 받는다. 연결된 기기가 하나뿐이면
플래그 없이 `npx expo run:android`로 실행하면 된다.
