import { Redirect } from 'expo-router';
import { useAuth } from '@/hooks/use-auth';

/**
 * 인증 상태에 따른 진입점 분기. 로딩·조회 실패 처리는 상위 _layout.tsx의
 * RootNavigator가 이미 끝냈으므로 여기서는 분기만 한다.
 *
 * 로그인/회원가입 성공 후에도 (main)으로 직접 이동하지 않고 이 경로로 replace한다.
 * (main)은 Stack.Protected로 가드되어 있어, 인증 상태가 리렌더에 반영되기 전에
 * 직접 이동하면 아직 열리지 않은 라우트라 이동이 무시될 수 있기 때문이다.
 * 이 화면은 항상 열려있고, 렌더 시점에는 갱신된 상태를 보고 판단한다.
 */
export default function Index() {
  const { isAuthenticated } = useAuth();
  return <Redirect href={isAuthenticated ? '/(main)/map' : '/(auth)/onboarding'} />;
}
