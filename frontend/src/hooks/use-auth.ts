import { useMutation, useQueryClient } from '@tanstack/react-query';
import { registerUser } from '@/api/auth';
import { queryKeys } from '@/lib/query-keys';

export function useRegisterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: registerUser,
    onSuccess: (profile) => {
      queryClient.setQueryData(queryKeys.auth.me, profile);
    },
  });
}
