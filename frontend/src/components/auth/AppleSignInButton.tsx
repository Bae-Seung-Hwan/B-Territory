import { Alert, StyleSheet } from 'react-native';
import { Button } from '@/components/ui/Button';
import { useTranslation } from '@/i18n';

/**
 * Sign in with Apple 골격 (App Store 심사 Guideline 4.8 — Google 로그인 제공 시 필수).
 *
 * 아직 기능 없는 스텁이다: 네이티브 모듈(expo-apple-authentication)은 Dev Build가
 * 필요한데 프로젝트는 아직 Expo Go 단계라 설치하지 않았다 (app.json에 iOS bundle
 * identifier도 없음). Dev Build 전환 시점과 남은 작업은 docs/integrations.md 참고.
 * iOS 전용 제약(Guideline 4.8)과 별개로 Android에서도 노출하기로 함.
 */
export function AppleSignInButton() {
  const { t } = useTranslation();

  const handlePress = () => {
    Alert.alert(t('auth.login.appleComingSoonTitle'), t('auth.login.appleComingSoonMessage'));
  };

  return (
    <Button
      title={t('auth.login.apple')}
      onPress={handlePress}
      variant="secondary"
      style={styles.button}
    />
  );
}

const styles = StyleSheet.create({
  button: { marginTop: 12, opacity: 0.6 },
});
