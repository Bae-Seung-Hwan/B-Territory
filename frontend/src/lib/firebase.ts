import { getApps, initializeApp } from 'firebase/app';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getAuth,
  initializeAuth,
  // @ts-expect-error - getReactNativePersistence exists in @firebase/auth's react-native
  // build at runtime (confirmed via Metro android bundle), but its package.json "exports"
  // map declares "types" ahead of the platform branches, so tsc always resolves the
  // generic (non-RN) .d.ts regardless of platform. Type-only gap, not a runtime bug.
  getReactNativePersistence,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Fast Refresh가 이 모듈을 재실행해도 initializeApp이 중복 호출로 죽지 않도록 가드
// (backend의 firebase.service.ts와 동일한 이유)
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

let auth: ReturnType<typeof getAuth>;
if (Platform.OS === 'web') {
  auth = getAuth(app);
} else {
  try {
    auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch {
    // Fast Refresh로 재실행되면 initializeAuth가 already-initialized를 던질 수 있어
    // 기존 인스턴스를 그대로 반환하는 getAuth로 폴백
    auth = getAuth(app);
  }
}

export { auth };
