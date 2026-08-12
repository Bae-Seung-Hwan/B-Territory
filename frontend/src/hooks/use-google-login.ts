import { useCallback } from 'react';
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from '@/lib/firebase';

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

// 모듈 최초 평가 시 한 번만 구성한다 — signIn()은 매 호출 전에 재구성할 필요가 없다.
// webClientId가 비어 있으면(콘솔에서 아직 발급 안 함) 네이티브 SDK가 실제 로그인 시도
// 시점에 에러를 던지므로, isConfigured로 그 전에 버튼 자체를 비활성화할 수 있게 한다.
GoogleSignin.configure({
  webClientId: WEB_CLIENT_ID,
  ...(IOS_CLIENT_ID ? { iosClientId: IOS_CLIENT_ID } : {}),
});

interface UseGoogleLoginOptions {
  onSuccess: () => void | Promise<void>;
  onError: (err: unknown) => void;
}

/**
 * Google 로그인 (네이티브 SDK + Firebase Auth 자격증명 교환).
 *
 * 예전엔 expo-auth-session의 generic OAuth 플로우를 썼으나, Google의 OAuth Web
 * 클라이언트가 Expo Go의 커스텀 스킴(exp://...) redirect URI를 거부하는 문제(게다가
 * 거부 화면을 닫으면 Expo Go 자체가 죽는 문제)가 있어 Dev Build 전환 후 네이티브
 * SDK로 교체했다 (docs/integrations.md "Google 로그인" 섹션 참고).
 */
export function useGoogleLogin({ onSuccess, onError }: UseGoogleLoginOptions) {
  const promptGoogleLogin = useCallback(async () => {
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) return; // 사용자가 취소함

      const idToken = response.data.idToken;
      if (!idToken) {
        onError(new Error('Google 로그인 응답에 idToken이 없습니다.'));
        return;
      }

      const credential = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(auth, credential);
      await onSuccess();
    } catch (err) {
      const isBenignCancel =
        isErrorWithCode(err) &&
        (err.code === statusCodes.SIGN_IN_CANCELLED || err.code === statusCodes.IN_PROGRESS);
      if (isBenignCancel) return;
      onError(err);
    }
  }, [onSuccess, onError]);

  return {
    isConfigured: !!WEB_CLIENT_ID,
    promptGoogleLogin,
  };
}
