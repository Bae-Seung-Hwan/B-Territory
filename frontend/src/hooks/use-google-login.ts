import { useEffect, useMemo } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from '@/lib/firebase';

WebBrowser.maybeCompleteAuthSession();

const CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const discovery = { authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth' };

interface UseGoogleLoginOptions {
  onSuccess: () => void | Promise<void>;
  onError: (err: unknown) => void;
}

/**
 * Google 로그인 (Firebase Auth 자격증명 교환).
 *
 * expo-auth-session/providers/google 대신 generic useAuthRequest를 직접 쓴다 —
 * deprecated된 헬퍼는 플랫폼별 네이티브 클라이언트 ID를 요구하는데, 우리는
 * Web 클라이언트 ID 하나로 충분한 implicit id_token 플로우만 쓰기 때문.
 *
 * ⚠️ Google의 OAuth Web 클라이언트는 redirect URI로 http(s)만 허용해서, Expo Go
 * 실기기(`exp://...`)에서는 redirect_uri_mismatch로 실패하는 게 정상이다.
 * `expo start --web`(redirect URI가 http://localhost:...)으로만 지금 검증 가능하며,
 * Dev Build 전환 시 네이티브 SDK(@react-native-google-signin/google-signin)로 교체 예정
 * (docs/decisions/0001-expo-go-vs-dev-build.md, docs/integrations.md 참고).
 */
export function useGoogleLogin({ onSuccess, onError }: UseGoogleLoginOptions) {
  const redirectUri = useMemo(() => AuthSession.makeRedirectUri({ scheme: 'b-territory' }), []);
  // nonce는 요청마다 한 번만 생성해야 한다. 매 렌더링마다 새로 만들면
  // extraParams가 매번 다른 객체가 되어 useAuthRequest의 useEffect가 계속
  // 재실행 -> setRequest -> 리렌더 -> nonce 재생성으로 이어지는 무한 루프에
  // 빠진다(로그인 화면에서 텍스트 입력 등 아무 리렌더링에도 CPU가 100%로 치솟음).
  const nonce = useMemo(() => Crypto.randomUUID(), []);
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: CLIENT_ID ?? '',
      redirectUri,
      responseType: AuthSession.ResponseType.IdToken,
      usePKCE: false,
      scopes: ['openid', 'profile', 'email'],
      extraParams: {
        nonce,
      },
    },
    discovery,
  );

  useEffect(() => {
    if (response?.type !== 'success') return;

    const idToken = response.params.id_token;
    if (!idToken) {
      onError(new Error('Google 로그인 응답에 id_token이 없습니다.'));
      return;
    }

    (async () => {
      try {
        const credential = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(auth, credential);
        await onSuccess();
      } catch (err) {
        onError(err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  return {
    request: CLIENT_ID ? request : null,
    promptGoogleLogin: () => promptAsync(),
  };
}
