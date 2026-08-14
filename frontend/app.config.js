// 값이 없으면 prebuild(EAS build 포함)는 에러 없이 성공하고, 지도 타일만 안 뜨는 상태로
// 조용히 실패한다(react-native-maps가 빈 키를 그대로 네이티브 매니페스트에 박아 넣기 때문).
// Android만 guard하는 이유: eas.json에 android 프로필만 있고 ios 빌드는 아직 안 한다.
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
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
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
