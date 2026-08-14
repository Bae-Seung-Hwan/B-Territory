import { useEffect, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { OAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useHandleAuthError } from '@/hooks/use-auth-error';
import { useFinishSocialLogin } from '@/hooks/use-social-auth';

/**
 * Sign in with Apple (App Store 심사 Guideline 4.8 — Google 로그인 제공 시 필수).
 *
 * Apple 브랜딩 규정상 커스텀 버튼이 아니라 네이티브 `AppleAuthenticationButton`을 써야
 * 하고, 그 컴포넌트 자체가 iOS 미지원 환경(Android, 구버전 iOS)에서는 null을 렌더링한다
 * (isAvailableAsync 체크는 그 자산이 없는 안드로이드에서 개발모드 경고를 피하기 위함).
 * 소셜 로그인 자체가 iOS 전용 기능이라 Android에는 아예 노출하지 않는다.
 */
interface AppleSignInButtonProps {
  /** 약관 동의 시트를 띄우고, 사용자가 동의를 마치면 resolve(true), 취소하면 resolve(false). */
  requestConsent: () => Promise<boolean>;
}

export function AppleSignInButton({ requestConsent }: AppleSignInButtonProps) {
  const [isAvailable, setIsAvailable] = useState(false);
  const handleAuthError = useHandleAuthError();
  const finishSocialLogin = useFinishSocialLogin();

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync().then(setIsAvailable);
  }, []);

  if (Platform.OS !== 'ios' || !isAvailable) return null;

  const handlePress = async () => {
    const agreed = await requestConsent();
    if (!agreed) return;
    try {
      // Firebase가 재전송 공격 방지를 위해 원문 nonce(rawNonce)를 요구하는데, Apple에는
      // 해시만 넘겨야 한다 — OAuthProvider.credential에 둘 다 실어 보내면 Firebase가
      // 해시를 재계산해 identityToken 안의 값과 대조한다.
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );

      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      if (!credential.identityToken) {
        throw new Error('Apple 로그인 응답에 identityToken이 없습니다.');
      }

      const provider = new OAuthProvider('apple.com');
      const firebaseCredential = provider.credential({
        idToken: credential.identityToken,
        rawNonce,
      });
      await signInWithCredential(auth, firebaseCredential);
      await finishSocialLogin();
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'ERR_REQUEST_CANCELED') return;
      handleAuthError(err, 'auth.errors.loginFailed');
    }
  };

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
      cornerRadius={12}
      style={styles.button}
      onPress={handlePress}
    />
  );
}

const styles = StyleSheet.create({
  button: { width: '100%', height: 50, marginTop: 12 },
});
