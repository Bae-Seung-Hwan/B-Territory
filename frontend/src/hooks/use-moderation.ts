import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import {
  blockUser,
  unblockUser,
  fetchBlockedUsers,
  reportUser,
  type CreateReportPayload,
} from '@/api/moderation';
import { queryKeys } from '@/lib/query-keys';
import { getApiErrorCode } from '@/lib/api-errors';
import { useTranslation } from '@/i18n';

type Translate = ReturnType<typeof useTranslation>['t'];

export function useBlockedUsers() {
  return useQuery({
    queryKey: queryKeys.moderation.blocks,
    queryFn: fetchBlockedUsers,
  });
}

export function useBlockMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: blockUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.moderation.blocks });
    },
  });
}

export function useUnblockMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: unblockUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.moderation.blocks });
    },
  });
}

export function useReportMutation() {
  return useMutation({
    mutationFn: (payload: CreateReportPayload) => reportUser(payload),
  });
}

/** 차단·신고 API 에러(axios)를 i18n 메시지로 매핑. use-review-mission.ts의 missionErrorMessage와 같은 패턴. */
export function moderationErrorMessage(error: unknown, t: Translate): string {
  if (!isAxiosError(error) || !error.response) {
    return t('moderation.errors.failed');
  }

  const code = getApiErrorCode(error);
  switch (code) {
    case 'BLOCK_SELF':
      return t('moderation.errors.blockSelf');
    case 'REPORT_SELF':
      return t('moderation.errors.reportSelf');
    case 'REPORT_RATE_LIMIT':
      return t('moderation.errors.reportRateLimit');
    case 'USER_NOT_FOUND':
      return t('moderation.errors.userNotFound');
    case 'USER_NOT_REGISTERED':
      return t('moderation.errors.userNotRegistered');
  }

  if (error.response.status === 401) return t('auth.errors.sessionExpired');
  return t('moderation.errors.failed');
}
