import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { deleteAccount } from '@/api/account';

/**
 * 401(계정이 이미 삭제된 뒤의 요청)이나 타임아웃(백엔드 삭제 처리가 apiClient의
 * 10초 타임아웃보다 오래 걸려 axios가 스스로 끊은 경우)이면, 이 기기의 세션은 더
 * 이상 쓸 수 없다 — 재시도해도 같은 401(세션 만료) → 무한 반복인 막다른 길이다
 * (PR #53 리뷰 지적 2번). 둘 다 성공했을 때와 같은 정리(signOut + 로그인 이동)로
 * 빠지지만, 실제 계정 삭제 여부는 다르다 — 401은 요청이 서버에 도달해 처리됐다는
 * 확정 신호지만, 타임아웃은 클라이언트가 응답을 기다리다 스스로 끊은 것이라
 * 서버까지 요청이 닿았는지조차 알 수 없다(2차 리뷰 지적 3번). 화면 쪽은 이 구분으로
 * 401에는 조용히, 타임아웃에는 "확인이 필요하다"는 중립 안내를 띄운다.
 * 그 외 오류(순수 네트워크 오류 등)는 계정이 삭제됐다고 볼 근거가 없어 제외한다.
 */
function classifyDeleteAccountFailure(err: unknown): 'confirmed' | 'timeout' | null {
  if (!isAxiosError(err)) return null;
  if (err.response?.status === 401) return 'confirmed';
  if (err.code === 'ECONNABORTED') return 'timeout';
  return null;
}

export function isDeleteAccountSessionDead(err: unknown): boolean {
  return classifyDeleteAccountFailure(err) !== null;
}

/** 세션이 죽긴 했지만 실제 삭제 여부가 불확실한 경우(타임아웃)인지 — 확정된 401과 구분한다. */
export function isDeleteAccountTimeout(err: unknown): boolean {
  return classifyDeleteAccountFailure(err) === 'timeout';
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
    } catch {
      // 로컬 세션 정리 실패는 되돌릴 것도, 사용자에게 알릴 것도 없다 — 서버 계정은
      // 이미 사라졌다. 여기서 삼키지 않으면 이 rejection이 TanStack Query의 훅
      // onSuccess try 블록(mutation.js)을 타고 mutation을 error 상태로 만들어,
      // 이미 삭제되고 로그인 화면으로 옮겨진 사용자에게 "탈퇴 실패" 알림이 뜬다
      // (2차 리뷰 지적 1번). onError 경로의 `void finishSession()`도 이걸로
      // unhandled rejection이 되지 않는다(2차 리뷰 지적 2번).
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
