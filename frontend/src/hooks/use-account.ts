import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { deleteAccount } from '@/api/account';

/**
 * 401(계정이 이미 삭제된 뒤의 요청)이나 타임아웃(백엔드 삭제 처리가 apiClient의
 * 10초 타임아웃보다 오래 걸려 axios가 스스로 끊은 경우)이면, 실제 응답과 무관하게
 * 이 기기의 세션은 더 이상 쓸 수 없다 — 재시도해도 같은 401(세션 만료) → 무한 반복인
 * 막다른 길이다(PR #53 리뷰 지적 2번). 두 경우 모두 성공했을 때와 같은 정리로 빠진다.
 * 그 외 오류(요청이 서버에 닿기 전에 끊긴 순수 네트워크 오류 등)는 계정이 삭제됐다고
 * 볼 근거가 없어 제외한다 — 화면 쪽에서 이 함수로 "이미 처리됨" 여부를 판단해 중복
 * 알림을 피한다.
 */
export function isDeleteAccountSessionDead(err: unknown): boolean {
  if (!isAxiosError(err)) return false;
  return err.code === 'ECONNABORTED' || err.response?.status === 401;
}

export function useDeleteAccountMutation() {
  const router = useRouter();

  // 백엔드가 계정을 완전히 삭제한 뒤라 서버 쪽 세션은 이미 무효다. signOut은 이
  // 기기의 로컬 Firebase 세션만 정리하는 것이고, 캐시 정리는 AuthProvider가 세션
  // 변경을 보고 처리한다.
  //
  // 이 정리를 mutate() 호출부가 아니라 여기(훅 옵션)에 두는 이유 — mutate()에 넘긴
  // onSuccess는 TanStack Query가 "떠도는 rejection"으로 흘려보내고(v5
  // mutationObserver.js의 #execute), async 콜백이라 그 안의 try/catch에도 안 걸린다.
  // signOut이 던지면 화면 전환이 아예 안 되고 삭제된 계정의 화면에 영구히 남는다
  // (PR #53 리뷰 지적 1번). 화면이 언마운트된 뒤에는 리스너가 없어 mutate() 콜백은
  // 통째로 스킵되기도 한다(지적 3번) — 훅 옵션 콜백은 Mutation.execute가 await하므로
  // 두 경우 모두 그대로 실행된다. 화면 이동은 signOut이 실패해도(예: 이미 로컬
  // 세션이 없는 경우) 반드시 실행되도록 finally에 둔다.
  const finishSession = async () => {
    try {
      await signOut(auth);
    } finally {
      router.replace('/(auth)/login');
    }
  };

  return useMutation({
    mutationFn: deleteAccount,
    onSuccess: finishSession,
    onError: (err) => {
      if (isDeleteAccountSessionDead(err)) void finishSession();
    },
  });
}
