import { Stack } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { SocketProvider } from '@/providers/SocketProvider';
import { AuthProvider } from '@/providers/AuthProvider';
import { EnemyDetectionAlert } from '@/components/overlay/EnemyDetectionAlert';
import { DuelRequest } from '@/components/overlay/DuelRequest';
import { MiniGame } from '@/components/overlay/MiniGame';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/use-auth';
import { useTranslation } from '@/i18n';
import { queryClient } from '@/lib/query-client';
import { BrandColors, Spacing } from '@/constants/theme';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BottomSheetModalProvider>
            <SocketProvider>
              <RootNavigator />
              <EnemyDetectionAlert />
              <DuelRequest />
              <MiniGame />
            </SocketProvider>
          </BottomSheetModalProvider>
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

/**
 * 인증 게이트. (main)을 Stack.Protected로 감싸 라우터 차원에서 막는다 —
 * app/index.tsx의 리다이렉트는 "/"로 들어온 경우에만 동작하므로, 딥링크·웹 URL
 * 직접 입력·푸시 알림처럼 "/"를 거치지 않는 진입은 검사를 건너뛰었다.
 *
 * (auth)는 일부러 가드하지 않는다. 로그인된 사용자가 로그인 화면을 여는 건 막을
 * 실익이 없고, 가드하면 로그아웃 시 (auth)가 열리기 전에 router.replace가 나가
 * 이동이 무시된다. 반대 방향(로그인 성공 후 (main)으로 이동)은 화면들이 항상
 * 열려있는 "/"로 replace하고 index가 판단을 내리게 해서 같은 문제를 피한다.
 */
function RootNavigator() {
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

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(main)" />
      </Stack.Protected>
    </Stack>
  );
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
