import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/Button';
import { useTranslation } from '@/i18n';
import { BrandColors, Spacing } from '@/constants/theme';

export default function Index() {
  const { isLoading, isUnavailable, isAuthenticated, isFetching, refetch } = useAuth();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={BrandColors.accent} />
      </View>
    );
  }

  // 세션은 유효한데 프로필 조회가 네트워크/5xx로 실패한 경우. 미가입으로 단정해
  // 온보딩으로 보내면 정상 가입자가 오프라인 부팅만으로 로그아웃된 것처럼 보인다.
  if (isUnavailable) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>{t('auth.session.loadFailed')}</Text>
        <Button title={t('auth.session.retry')} onPress={() => refetch()} loading={isFetching} />
      </View>
    );
  }

  return <Redirect href={isAuthenticated ? '/(main)/map' : '/(auth)/onboarding'} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: BrandColors.background,
  },
  message: {
    color: '#ccc',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: Spacing.three,
  },
});
