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
      // react-native-maps는 앱 빌드(prebuild) 시점에 네이티브 매니페스트/Info.plist에
      // 키를 박아 넣는 방식이라 EXPO_PUBLIC_* 런타임 변수가 아니라 이 config plugin
      // props로 전달해야 한다. 값은 로컬 .env(GOOGLE_MAPS_ANDROID_API_KEY /
      // GOOGLE_MAPS_IOS_API_KEY)와 EAS 환경변수(development)에 등록해서 관리한다.
      [
        'react-native-maps',
        {
          androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY,
          iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY,
        },
      ],
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
