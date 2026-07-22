import { Stack } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { SocketProvider } from '@/providers/SocketProvider';
import { EnemyDetectionAlert } from '@/components/overlay/EnemyDetectionAlert';
import { DuelRequest } from '@/components/overlay/DuelRequest';
import { MiniGame } from '@/components/overlay/MiniGame';
import { queryClient } from '@/lib/query-client';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <BottomSheetModalProvider>
          <SocketProvider>
            <Stack screenOptions={{ headerShown: false }} />
            <EnemyDetectionAlert />
            <DuelRequest />
            <MiniGame />
          </SocketProvider>
        </BottomSheetModalProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
