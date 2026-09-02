import { useRouter } from 'expo-router';
import { useQueryClient, isCancelledError, type QueryClient } from '@tanstack/react-query';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getMe } from '@/api/auth';
import { queryKeys } from '@/lib/query-keys';

/**
 * 계정 전환(다른 Google/Apple 계정으로 재로그인) 시 AuthProvider의 onAuthStateChanged가
 * uid 변경을 감지하고 queryKeys.auth.me 캐시를 removeQueries로 비우는데, 그 시점이 이
 * fetchQuery와 겹치면 react-query가 in-flight 쿼리를 CancelledError로 reject한다. 로그인
 * 자체는 성공했으므로 실패로 취급하지 않고 캐시가 정리된 뒤 다시 한번 조회한다.
 */
async function fetchProfile(queryClient: QueryClient) {
  try {
    return await queryClient.fetchQuery({ queryKey: queryKeys.auth.me, queryFn: getMe });
  } catch (err) {
    if (isCancelledError(err)) {
      return queryClient.fetchQuery({ queryKey: queryKeys.auth.me, queryFn: getMe });
    }
    throw err;
  }
}

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
 * 거부하면 Firebase 세션도 함께 정리한다 — 남겨두면 로그인 화면의 "회원가입 하기"가
 * use-registration-flow.ts의 auth.currentUser 기반 초기 판단 때문에 register.tsx를
 * 폼이 아니라 "인증 메일을 확인하세요" 단계로 잘못 열어버린다(PR #48 리뷰 지적). 이메일
 * 경로(login.tsx의 finishLogin)가 "세션은 있는데 미가입"일 때 signOut하는 것과 동일하다.
 *
 * fetchProfile 이후 어느 단계에서든 실패하면(예: getMe가 오프라인/5xx로 거부) 여기서
 * signOut까지 하고 다시 throw한다 — 그러지 않으면 signInWithCredential로 만들어진
 * Firebase 세션만 고아로 남아, 이후 로그인 화면의 "회원가입 하기"가
 * use-registration-flow.ts의 auth.currentUser 기반 판단 때문에 register.tsx를 폼이 아닌
 * "인증 메일을 확인하세요" 단계로 잘못 열어버린다(PR #48 3차 리뷰 #2·#3). Google/Apple
 * 호출부는 각자 catch에서 알럿만 띄우면 되고 정리는 여기 한 곳에서 끝난다.
 */
export function useFinishSocialLogin(requestConsent: () => Promise<boolean>) {
  const router = useRouter();
  const queryClient = useQueryClient();

  return async () => {
    try {
      const profile = await fetchProfile(queryClient);

      if (profile) {
        // (main)은 가드되어 있어 인증 상태가 리렌더에 반영되기 전까진 열리지 않으므로,
        // 항상 열려있는 "/"로 보내 index가 판단하게 한다 (login.tsx의 finishLogin과 동일).
        router.replace('/');
        return;
      }

      const agreed = await requestConsent();
      if (!agreed) {
        await signOut(auth);
        return;
      }
      // push가 아니라 replace다 — push라면 하드웨어 백/스와이프로 login 화면에 돌아갈 수
      // 있고, 그 순간 "Firebase 세션은 있는데 가입은 안 된" 상태가 되어 위와 같은 문제가
      // 재현된다(PR #48 리뷰 지적).
      router.replace('/(auth)/complete-profile');
    } catch (err) {
      await signOut(auth);
      throw err;
    }
  };
}
