import { Platform, TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';

/**
 * Sign in with Apple 골격 (App Store 심사 Guideline 4.8 — Google 로그인 제공 시 필수).
 *
 * 아직 기능 없는 스텁이다: 네이티브 모듈(expo-apple-authentication)은 Dev Build가
 * 필요한데 프로젝트는 아직 Expo Go 단계라 설치하지 않았다 (app.json에 iOS bundle
 * identifier도 없음). Dev Build 전환 시점과 남은 작업은 docs/integrations.md 참고.
 */
export function AppleSignInButton() {
  const { t } = useTranslation();

  if (Platform.OS !== 'ios') return null;

  const handlePress = () => {
    Alert.alert(t('auth.login.appleComingSoonTitle'), t('auth.login.appleComingSoonMessage'));
  };

  return (
    <TouchableOpacity style={styles.button} onPress={handlePress}>
      <Text style={styles.text}>{t('auth.login.apple')}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
    paddingVertical: 16,
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BrandColors.border,
    marginTop: 12,
    opacity: 0.6,
  },
  text: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
