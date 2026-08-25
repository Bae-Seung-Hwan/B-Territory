import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { checkinMission, submitReviewMission } from '@/api/missions';
import { queryKeys } from '@/lib/query-keys';
import { getApiErrorCode } from '@/lib/api-errors';
import { loadVisitCheckin, saveVisitCheckin, clearVisitCheckin } from '@/lib/visit-checkin';
import { useTranslation } from '@/i18n';

type Translate = ReturnType<typeof useTranslation>['t'];

export interface MissionFeedback {
  tone: 'success' | 'error';
  text: string;
}

/**
 * 상세 시트의 "리뷰 작성" 섹션 뒤에 있는 두 요청(체크인 → 리뷰 등록)을 관리한다.
 *
 * 체크인 여부(`checkedIn`)는 이번 마운트에서의 mutation 성공 여부뿐 아니라, 기기에 보존해 둔
 * 방문 창(visit-checkin.ts)도 함께 반영한다 — 시트를 닫았다 다시 열어도(같은 관광지) 24시간
 * 창 안이면 재체크인을 요구하지 않기 위해서다. 최종 검증은 항상 서버가 하므로(requireVisit),
 * 캐시가 실제보다 낙관적이어도 리뷰 제출 시 MISSION_VISIT_REQUIRED로 걸러진다 — 그 경우
 * 캐시를 지우고 체크인 버튼을 다시 노출한다.
 */
export function useReviewMission(spotId: number | null) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [persistedCheckedIn, setPersistedCheckedIn] = useState(false);

  useEffect(() => {
    if (spotId == null) return;
    let cancelled = false;
    loadVisitCheckin(spotId).then((checkedIn) => {
      if (!cancelled) setPersistedCheckedIn(checkedIn);
    });
    return () => {
      cancelled = true;
    };
  }, [spotId]);

  const checkin = useMutation({
    mutationFn: (vars: { lat: number; lng: number }) => checkinMission(spotId!, vars.lat, vars.lng),
    onSuccess: (result) => {
      saveVisitCheckin(result.spotId, result.expiresInSeconds);
      setPersistedCheckedIn(true);
    },
  });

  const review = useMutation({
    mutationFn: (vars: { rating: number; content?: string }) =>
      submitReviewMission(spotId!, vars.rating, vars.content),
    onSuccess: () => {
      if (spotId != null) {
        queryClient.invalidateQueries({ queryKey: queryKeys.missions.reviews(spotId) });
        clearVisitCheckin(spotId);
      }
    },
    onError: (error) => {
      // 캐시는 유효하다고 했는데 서버는 만료로 판단한 경우 — 캐시를 버리고 재체크인 경로로 되돌린다.
      if (spotId != null && getApiErrorCode(error) === 'MISSION_VISIT_REQUIRED') {
        clearVisitCheckin(spotId);
        setPersistedCheckedIn(false);
      }
    },
  });

  const checkedIn = checkin.isSuccess || persistedCheckedIn;

  const checkinFeedback: MissionFeedback | null = checkin.error
    ? { tone: 'error', text: missionErrorMessage(checkin.error, t) }
    : null;

  const reviewFeedback: MissionFeedback | null = review.data
    ? { tone: 'success', text: t('map.reviewMission.success', { points: review.data.pointsAwarded }) }
    : review.error
      ? { tone: 'error', text: missionErrorMessage(review.error, t) }
      : null;

  return { checkin, review, checkedIn, checkinFeedback, reviewFeedback };
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
