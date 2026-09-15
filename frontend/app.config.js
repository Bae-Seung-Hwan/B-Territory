// 값이 없으면 prebuild(EAS build 포함)는 에러 없이 성공하고, 지도 타일만 안 뜨는 상태로
// 조용히 실패한다(react-native-maps가 빈 키를 그대로 네이티브 매니페스트에 박아 넣기 때문).
// Android만 guard하는 이유: eas.json 각 프로필에 iOS 전용 설정이 없어 ios 빌드는 아직 안 한다.
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name}가 설정되지 않았습니다. .env를 확인하세요 (.env.example 참고)`,
    );
  }
  return value;
}

// google-signin 네이티브 SDK의 config plugin은(옵션 없이 호출 시) GoogleService-Info.plist/
// google-services.json 존재를 전제로 한다. 이 프로젝트는 Firebase JS SDK만 쓰고 네이티브
// Firebase 설정 파일이 없으므로, 대신 iosUrlScheme만 넘겨 "Firebase 없이" 모드로 강제한다.
// 값이 없으면(아직 Google Cloud Console에서 iOS OAuth client를 발급받지 않음) 이 plugin은
// validateOptions에서 즉시 throw하므로, iOS 빌드를 시작하기 전까지는 plugin 자체를 아예
// 배열에서 뺀다 — Android 네이티브 로그인은 Google Cloud Console에 SHA-1만 등록하면 되고
// 이 plugin이 건드리는 iOS Info.plist와 무관하게 동작한다.
const googleIosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;

module.exports = {
  expo: {
    name: 'B-territory',
    slug: 'B-territory',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'b-territory',
    userInterfaceStyle: 'automatic',
    ios: {
      icon: './assets/images/icon.png',
      bundleIdentifier: 'com.bterritory.app',
    },
    android: {
      package: 'com.bterritory.app',
      // 키보드가 뜰 때 Bottom Tab 내비게이터의 탭바가 밀려 올라가 입력창을 가리는
      // 문제는 (main)/_layout.tsx의 tabBarHideOnKeyboard로 해결한다. 한때 이 값을
      // softwareKeyboardLayoutMode: 'pan'으로도 바꿨었지만, 그러면 기본값(resize)의
      // 화면 리사이즈에 기대는 다른 화면(register.tsx의 ScrollView 등)의 키보드 동작이
      // 앱 전역에서 달라진다 — 한 화면 문제를 앱 전체 설정으로 풀면서 생긴 광범위한
      // 부작용이라(PR #50 2차 리뷰 지적) tabBarHideOnKeyboard만 남겼다.
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      // 자동링크된 네이티브 모듈이 **자기 AndroidManifest로** 끌고 들어오는 저장소 권한을
      // 최종 매니페스트에서 제거한다(`tools:node="remove"`). expo-file-system이 전이
      // 의존성으로 들어와 READ/WRITE_EXTERNAL_STORAGE를 maxSdkVersion="32"로 선언하는데,
      // 이 앱은 공용 저장소를 쓰지 않는다 — 앱 전용 디렉터리(캐시·에셋)는 권한 없이 접근
      // 가능하고, src/ 어디에서도 expo-file-system을 직접 import하지 않는다.
      //
      // 지우지 않으면 Android 12 이하에서 **고지하지 않은 접근권한이 선언된 APK**가 나간다.
      // 정보통신망법 제22조의2가 요구하는 고지 목록(constants/app-permissions.ts)과 실제
      // 매니페스트가 어긋나는 것이고, 그게 원스토어 반려 사유 1번의 실제 내용이다. 저장소
      // 기능을 실제로 쓰게 되는 날에는 이 항목을 지우는 게 아니라 고지 목록에 추가한다.
      //
      // INTERNET·ACCESS_NETWORK_STATE는 남긴다 — 단말기 정보·기능에 접근하는 권한이 아닌
      // 일반권한(normal permission)이라 고지 대상이 아니고, 실제로 필요하다.
      blockedPermissions: [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ],
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#208AEF',
          android: {
            image: './assets/images/splash-icon.png',
            imageWidth: 76,
          },
        },
      ],
      'expo-localization',
      'expo-web-browser',
      'expo-apple-authentication',
      // react-native-maps는 앱 빌드(prebuild) 시점에 네이티브 매니페스트/Info.plist에
      // 키를 박아 넣는 방식이라 EXPO_PUBLIC_* 런타임 변수가 아니라 이 config plugin
      // props로 전달해야 한다. 값은 로컬 .env(GOOGLE_MAPS_ANDROID_API_KEY /
      // GOOGLE_MAPS_IOS_API_KEY)와 EAS 환경변수(development)에 등록해서 관리한다.
      [
        'react-native-maps',
        {
          androidGoogleMapsApiKey: requireEnv('GOOGLE_MAPS_ANDROID_API_KEY'),
          iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY,
        },
      ],
      ...(googleIosUrlScheme
        ? [
            [
              '@react-native-google-signin/google-signin',
              { iosUrlScheme: googleIosUrlScheme },
            ],
          ]
        : []),
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: 'e0b841b9-e9dd-46f7-b29f-950f51b178dc',
      },
    },
    owner: 'rsh_17',
  },
};
