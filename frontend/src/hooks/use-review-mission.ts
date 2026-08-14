import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { checkinMission, submitReviewMission } from '@/api/missions';
import { queryKeys } from '@/lib/query-keys';
import { getApiErrorCode } from '@/lib/api-errors';
import { useTranslation } from '@/i18n';

type Translate = ReturnType<typeof useTranslation>['t'];

export interface MissionFeedback {
  tone: 'success' | 'error';
  text: string;
}

/**
 * 상세 시트의 "리뷰 작성" 섹션 뒤에 있는 두 요청(체크인 → 리뷰 등록)을 관리한다.
 * 체크인 성공 여부는 이 훅이 아니라 호출부가 로컬 상태로 들고 있는다 — 시트를 다시 열면
 * (spot이 바뀌면) 그 상태를 초기화해야 하는데, 그 초기화 시점은 화면(SpotDetailSheet)의
 * 책임이지 요청 훅의 책임이 아니기 때문이다.
 */
export function useReviewMission(spotId: number | null) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const checkin = useMutation({
    mutationFn: (vars: { lat: number; lng: number }) => checkinMission(spotId!, vars.lat, vars.lng),
  });

  const review = useMutation({
    mutationFn: (vars: { rating: number; content?: string }) =>
      submitReviewMission(spotId!, vars.rating, vars.content),
    onSuccess: () => {
      if (spotId != null) {
        queryClient.invalidateQueries({ queryKey: queryKeys.missions.reviews(spotId) });
      }
    },
  });

  const checkinFeedback: MissionFeedback | null = checkin.error
    ? { tone: 'error', text: missionErrorMessage(checkin.error, t) }
    : null;

  const reviewFeedback: MissionFeedback | null = review.data
    ? { tone: 'success', text: t('map.reviewMission.success', { points: review.data.pointsAwarded }) }
    : review.error
      ? { tone: 'error', text: missionErrorMessage(review.error, t) }
      : null;

  return { checkin, review, checkinFeedback, reviewFeedback };
}

function missionErrorMessage(error: unknown, t: Translate): string {
  if (!isAxiosError(error)) return t('map.reviewMission.errors.failed');
  if (!error.response) return t('map.reviewMission.errors.failed');

  const code = getApiErrorCode(error);
  switch (code) {
    case 'MISSION_VISIT_REQUIRED':
      return t('map.reviewMission.errors.visitRequired');
    case 'MISSION_DAILY_LIMIT':
      return t('map.reviewMission.errors.dailyLimit');
    case 'SPOT_NO_COORDINATES':
      return t('map.reviewMission.errors.noCoordinates');
    case 'SPOT_NOT_FOUND':
      return t('map.reviewMission.errors.spotNotFound');
    case 'VISIT_OUT_OF_RANGE':
      // 거리 안내가 서버 메시지(한국어 고정)에만 동적으로 실려 있어 그대로 보여준다 —
      // use-claim-attempt.ts의 DEFENSE_ACTIVE 처리와 같은 이유.
      return serverMessage(error.response.data) ?? t('map.reviewMission.errors.outOfRange');
  }

  if (error.response.status === 401) return t('map.claimAttempt.loginRequired');
  return serverMessage(error.response.data) ?? t('map.reviewMission.errors.failed');
}

function serverMessage(body: unknown): string | null {
  const message = (body as { message?: unknown } | undefined)?.message;
  if (Array.isArray(message)) return typeof message[0] === 'string' ? message[0] : null;
  return typeof message === 'string' ? message : null;
}
