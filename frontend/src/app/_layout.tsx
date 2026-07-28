import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SocketProvider } from '@/providers/SocketProvider';
import { EnemyDetectionAlert } from '@/components/overlay/EnemyDetectionAlert';
import { DuelRequest } from '@/components/overlay/DuelRequest';
import { MiniGame } from '@/components/overlay/MiniGame';

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SocketProvider>
        <Stack screenOptions={{ headerShown: false }} />
        <EnemyDetectionAlert />
        <DuelRequest />
        <MiniGame />
      </SocketProvider>
    </QueryClientProvider>
  );
}
