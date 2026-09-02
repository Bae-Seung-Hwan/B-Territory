import { useMutation } from '@tanstack/react-query';
import { deleteAccount } from '@/api/account';

export function useDeleteAccountMutation() {
  return useMutation({ mutationFn: deleteAccount });
}
