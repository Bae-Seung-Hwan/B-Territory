import { Redirect } from 'expo-router';
import { useUserStore } from '@/store/useUserStore';

export default function Index() {
  const isAuthenticated = useUserStore((s) => s.isAuthenticated);
  return <Redirect href={isAuthenticated ? '/(main)/map' : '/(auth)/onboarding'} />;
}
