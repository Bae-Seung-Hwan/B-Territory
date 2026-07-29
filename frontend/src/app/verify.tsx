import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVerifyEmailToken } from '@/hooks/use-email-verification';
import { getApiErrorMessage } from '@/lib/api-errors';
import { Button } from '@/components/ui/Button';
import { useTranslation } from '@/i18n';
import { BrandColors, Spacing } from '@/constants/theme';

/**
 * 이메일 인증 매직 링크(`${FRONTEND_URL}/verify?token=...`)가 열리는 화면.
 *
 * 인증 사실은 서버에 이메일 기준으로 남으므로(30분), 이 화면을 앱이 아닌 폰 브라우저에서
 * 열어도 된다. 사용자는 인증만 마치고 앱으로 돌아가 가입을 이어가면 된다.
 *
 * (main) 밖의 루트 라우트라 로그인 없이 접근 가능하다.
 */
export default function VerifyScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { mutate, isPending, isSuccess, isError, error } = useVerifyEmailToken();
  // 토큰은 1회용이라 StrictMode의 이펙트 이중 실행으로 두 번 소비되면 안 된다.
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current || !token) return;
    firedRef.current = true;
    mutate(token);
  }, [token, mutate]);

  const goToRegister = () => router.replace('/(auth)/register');

  if (!token) {
    return (
      <Screen title={t('auth.emailVerification.failedTitle')}>
        <Text style={styles.message}>{t('auth.emailVerification.missingToken')}</Text>
        <Button title={t('auth.emailVerification.goToRegister')} onPress={goToRegister} />
      </Screen>
    );
  }

  if (isPending) {
    return (
      <Screen title={t('auth.emailVerification.verifyingTitle')}>
        <ActivityIndicator color={BrandColors.accent} />
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen title={t('auth.emailVerification.failedTitle')}>
        <Text style={styles.message}>
          {getApiErrorMessage(error, t, 'auth.emailVerification.failedMessage')}
        </Text>
        <Button title={t('auth.emailVerification.goToRegister')} onPress={goToRegister} />
      </Screen>
    );
  }

  if (isSuccess) {
    return (
      <Screen title={t('auth.emailVerification.successTitle')}>
        <Text style={styles.message}>{t('auth.emailVerification.successMessage')}</Text>
        <Button title={t('auth.emailVerification.goToRegister')} onPress={goToRegister} />
      </Screen>
    );
  }

  return (
    <Screen title={t('auth.emailVerification.verifyingTitle')}>
      <ActivityIndicator color={BrandColors.accent} />
    </Screen>
  );
}

function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: BrandColors.background,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: Spacing.three,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#ccc',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing.four,
  },
});
