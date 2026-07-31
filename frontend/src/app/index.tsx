import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/hooks/use-auth';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { BrandColors, Spacing } from '@/constants/theme';

/**
 * 인증 상태에 따른 진입점 분기.
 *
 * 로딩/조회실패 UI를 (과거 _layout.tsx의 RootNavigator 대신) 여기서 렌더한다 —
 * "/"로 들어왔을 때만 의미 있는 판단이라, (auth) 화면이 떠 있는 동안 백그라운드로
 * 진행되는 auth.me 조회 때문에 그 화면이 스피너로 통째로 대체되는 일이 없다.
 *
 * 로그인/회원가입 성공 후에도 (main)으로 직접 이동하지 않고 이 경로로 replace한다.
 * (main)은 Stack.Protected로 가드되어 있어, 인증 상태가 리렌더에 반영되기 전에
 * 직접 이동하면 아직 열리지 않은 라우트라 이동이 무시될 수 있기 때문이다.
 * 이 화면은 항상 열려있고, 렌더 시점에는 갱신된 상태를 보고 판단한다.
 */
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
