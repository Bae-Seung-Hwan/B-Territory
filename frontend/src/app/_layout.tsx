import { Stack } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { SocketProvider } from '@/providers/SocketProvider';
import { AuthProvider } from '@/providers/AuthProvider';
import { DuelRequest } from '@/components/overlay/DuelRequest';
import { DuelPending } from '@/components/overlay/DuelPending';
import { MiniGame } from '@/components/overlay/MiniGame';
import { LocationBroadcaster } from '@/components/LocationBroadcaster';
import { useAuth } from '@/hooks/use-auth';
import { queryClient } from '@/lib/query-client';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BottomSheetModalProvider>
            <SocketProvider>
              <RootNavigator />
              <LocationBroadcaster />
              <DuelRequest />
              <DuelPending />
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
 *
 * 로딩/조회실패 UI는 여기서 렌더하지 않는다 — <Stack>을 통째로 스피너로 바꾸면
 * 그 순간 마운트돼 있던 (auth) 화면(예: 회원가입 진행 중인 register.tsx)이
 * 언마운트되어 입력값을 잃는다(계정 생성 성공 직후 auth.me 조회가 시작되며
 * isLoading이 잠깐 true가 되는 구간에서 실제로 발생). <Stack>은 항상 렌더하고,
 * 로딩/에러 판단은 "/"로 들어왔을 때만 의미가 있으므로 index.tsx로 옮겼다.
 */
function RootNavigator() {
  const { isAuthenticated } = useAuth();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(main)" />
      </Stack.Protected>
    </Stack>
  );
}
