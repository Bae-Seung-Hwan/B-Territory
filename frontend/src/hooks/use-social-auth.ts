import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getMe } from '@/api/auth';
import { queryKeys } from '@/lib/query-keys';

/**
 * Google/Apple 로그인처럼 Firebase 자격증명 교환까지 끝난 직후 공통으로 필요한 후처리.
 *
 * 이메일/비밀번호 흐름(login.tsx의 finishLogin)은 getMe()가 404면 "이메일/비밀번호를
 * 다시 확인해달라"고 안내하는데, 이는 비밀번호 재확인이라는 복구 수단이 있는 경우에만
 * 의미가 있다. 소셜 로그인엔 그 개념이 없으므로 — Provider가 이미 신원과 이메일 인증을
 * 보장한 상태이므로 — 404는 곧장 "가입 안 한 신규 유저"로 보고 닉네임/국적만 받는
 * 프로필 완성 화면으로 보낸다.
 *
 * 약관 동의(requestConsent)는 인증 전이 아니라 여기, 신규 유저로 판명된 뒤에만 요청한다.
 * 인증 전에는 신규/기존을 구분할 수 없어 무조건 물으면, 이미 동의를 마친 기존 유저도
 * Google/Apple로 로그인할 때마다 체크박스를 다시 눌러야 한다(PR #48 리뷰 지적). 동의를
 * 거부해도 Firebase 세션 자체는 남지만, 가입(registerUser)까지는 진행하지 않고 그대로
 * 둔다 — 다음에 로그인 버튼을 다시 누르면 같은 분기로 재진입한다.
 */
export function useFinishSocialLogin(requestConsent: () => Promise<boolean>) {
  const router = useRouter();
  const queryClient = useQueryClient();

  return async () => {
    const profile = await queryClient.fetchQuery({ queryKey: queryKeys.auth.me, queryFn: getMe });

    if (profile) {
      // (main)은 가드되어 있어 인증 상태가 리렌더에 반영되기 전까진 열리지 않으므로,
      // 항상 열려있는 "/"로 보내 index가 판단하게 한다 (login.tsx의 finishLogin과 동일).
      router.replace('/');
      return;
    }

    const agreed = await requestConsent();
    if (!agreed) return;
    router.push('/(auth)/complete-profile');
  };
}
