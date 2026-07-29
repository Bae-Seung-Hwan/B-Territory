import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMe, registerUser } from '@/api/auth';
import { queryKeys } from '@/lib/query-keys';
import { useAuthSession } from '@/providers/AuthProvider';

/**
 * 인증 상태의 단일 소스. Firebase 세션(있는가)과 백엔드 프로필(가입했는가)을
 * queryKeys.auth.me 쿼리 하나에서 파생시킨다. 화면들이 각자 조회해 스토어에
 * 복사하지 않으므로 서로 덮어쓸 상태 자체가 없다.
 */
export function useAuth() {
  const { firebaseUser } = useAuthSession();

  const query = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: getMe,
    enabled: !!firebaseUser,
  });

  return {
    firebaseUser,
    profile: query.data ?? null,
    // 세션이 없으면 조회할 것도 없다. enabled:false인 쿼리도 status는 'pending'이라
    // 세션 유무로 먼저 걸러야 한다.
    isLoading: !!firebaseUser && query.isPending,
    // getMe는 404(진짜 미가입)만 null로 흡수하고 네트워크/5xx는 그대로 던진다.
    // 둘을 구분해야 일시적 장애를 "미가입"으로 오판해 온보딩으로 되돌리지 않는다.
    isUnavailable: !!firebaseUser && query.isError,
    isAuthenticated: !!firebaseUser && !!query.data,
    // 실패 후 재시도 중에는 status가 'error'로 남아 isPending으로는 알 수 없다.
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}

export function useRegisterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: registerUser,
    onSuccess: async (profile) => {
      // 계정 생성 직후 AuthProvider가 세션 변경을 감지해 auth.me 조회를 시작하는데,
      // 그 시점엔 백엔드 프로필이 아직 없어 404 -> null이다. 그 응답이 이 등록
      // 성공보다 늦게 resolve되면 방금 받은 프로필을 null로 덮어쓴다. 진행 중인
      // 조회를 취소한 뒤 캐시를 채워 순서와 무관하게 등록 결과가 남도록 한다.
      await queryClient.cancelQueries({ queryKey: queryKeys.auth.me });
      queryClient.setQueryData(queryKeys.auth.me, profile);
    },
  });
}
