import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { attemptClaim, type ClaimMission } from '@/api/claims';
import { missionRejectedKey } from '@/constants/claimMissions';
import { queryKeys } from '@/lib/query-keys';
import { getApiErrorCode } from '@/lib/api-errors';
import { useTranslation } from '@/i18n';

type Translate = ReturnType<typeof useTranslation>['t'];

export interface ClaimFeedback {
  tone: 'success' | 'error';
  text: string;
}

interface AttemptVariables {
  spotId: number;
  mission: ClaimMission;
}

/**
 * 상세 시트의 점령 미션 버튼 뒤에 있는 요청 한 건을 관리한다. 미션 종류와 무관하게
 * "보내고 → 결과 문구를 만들고 → 점령 현황을 새로 고친다"까지가 공통이므로, 미션별로
 * 갈리는 건 어느 엔드포인트로 보낼지(api/claims.ts)와 400의 사유 문구뿐이다.
 *
 * 성공하면 이 관광지의 점령 현황 쿼리를 무효화한다 — 시트의 배지와 말풍선이 같은
 * queryKeys.claims.spot을 보고 있어, 방금 내 팀이 가져갔다는 사실이 그대로 반영된다.
 */
export function useClaimAttempt() {
  const { t, locale } = useTranslation();
  const queryClient = useQueryClient();

  const { mutate, data, error, variables, isPending, reset } = useMutation({
    mutationFn: ({ spotId, mission }: AttemptVariables) => attemptClaim(spotId, mission),
    onSuccess: (result) => {
      // queryKeys.claims.spot이 lang을 키에 포함하므로(SpotClaim에 언어별 description이 실림),
      // 지금 locale 기준 키만 무효화한다 — 다른 locale로 조회한 캐시가 있어도 이 세션에선 안 쓴다.
      queryClient.invalidateQueries({ queryKey: queryKeys.claims.spot(result.spotId, locale) });
    },
  });

  const feedback: ClaimFeedback | null = data
    ? { tone: 'success', text: t('map.claimAttempt.success', { points: data.pointsAwarded }) }
    : error
      ? { tone: 'error', text: errorMessage(error, variables, t) }
      : null;

  return {
    attempt: mutate,
    isPending,
    reset,
    feedback,
    /** feedback이 어느 관광지의 결과인지 — 다른 관광지를 열었을 때 남은 문구를 걸러내는 용도 */
    feedbackSpotId: feedback ? (variables?.spotId ?? null) : null,
  };
}

function errorMessage(
  error: unknown,
  variables: AttemptVariables | undefined,
  t: Translate,
): string {
  if (!isAxiosError(error)) return t('map.claimAttempt.failed');

  // code가 있으면(PR #30 이후 백엔드) 상태코드만으론 못 갈랐던 409(방어 중 vs 일일 점령
  // 제한)를 정확히 나눈다. code가 없는 구 백엔드는 아래 상태코드 기반 분기로 폴백한다.
  const code = getApiErrorCode(error);
  if (code === 'DAILY_CLAIM_LIMIT') return t('map.claimAttempt.dailyLimit');
  if (code === 'DEFENSE_ACTIVE') {
    // 어느 팀이 몇 초 남았는지는 서버 메시지에만 있어 번역하지 않고 그대로 보여준다.
    return serverMessage(error.response?.data) ?? t('map.claimAttempt.failed');
  }

  // 서버 메시지는 한국어 고정이라, 상태 코드만으로 원인이 특정되는 경우엔 번역문을 쓴다.
  // 409만 예외로 서버 메시지를 그대로 보여준다 — code가 없는 구 백엔드에서는 "방어 시간 중"과
  // "일일 점령 제한"이 같은 상태코드를 쓰고 남은 방어 시간(초)까지 문구에 들어 있어, 상태
  // 코드만으로는 구분할 수 없다.
  switch (error.response?.status) {
    case 400:
      // 자격 미달의 사유는 미션마다 다르다(방문 인증이면 거리, 퀴즈면 오답 …).
      return variables
        ? t(missionRejectedKey(variables.mission.type))
        : t('map.claimAttempt.failed');
    case 401:
      return t('map.claimAttempt.loginRequired');
    case 403:
      return t('map.claimAttempt.penalty');
    case 404:
      return t('map.claimAttempt.spotNotFound');
    default:
      return serverMessage(error.response?.data) ?? t('map.claimAttempt.failed');
  }
}

/** NestJS 예외 응답 본문의 message는 문자열 또는 문자열 배열(유효성 검사 실패)로 온다. */
function serverMessage(body: unknown): string | null {
  const message = (body as { message?: unknown } | undefined)?.message;
  if (Array.isArray(message)) return typeof message[0] === 'string' ? message[0] : null;
  return typeof message === 'string' ? message : null;
}
