import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSpotClaim } from '@/api/claims';
import { queryKeys } from '@/lib/query-keys';
import { useTranslation } from '@/i18n';

/** 말풍선에 띄울 점령 현황. 조회가 끝나기 전에는 null이다. */
export interface SpotClaimState {
  spotId: number;
  text: string;
  /**
   * 이 결과를 부른 탭의 일련번호. 마커는 이 값이 바뀔 때만 말풍선을 연다.
   *
   * 문구가 아니라 번호인 이유: 같은 마커를 다시 탭했을 때 결과가 이전과 같으면
   * (예: 계속 미점령) 문구에 변화가 없어 열림 신호를 놓친다.
   * "조회가 끝난 시각"이 아니라 탭 횟수인 이유: 점령 시도 성공처럼 탭과 무관하게 일어나는
   * 재조회(invalidate)까지 열림 신호로 잡히면, 상세 시트를 띄우느라 방금 닫은 말풍선을
   * 곧바로 다시 열게 된다. 그러면 아직 네이티브에서 분리되지 않은 말풍선 뷰를 Google Maps가
   * 다시 붙이려다 IllegalStateException("child already has a parent")으로 앱이 죽는다.
   */
  openSeq: number;
}

/**
 * 마커 탭 → 점령 현황 조회 → 말풍선에 띄울 문구까지를 한 곳에서 관리한다.
 *
 * 조회 상태를 마커가 아니라 화면 쪽에서 들고 있어야 하는 이유: 마커를 탭하면 Android가
 * 말풍선을 보이려 카메라를 옮기고, 그때 뷰포트 필터가 다시 돌면서 그 마커가 잠깐 언마운트될 수
 * 있다. 상태가 마커 안에 있으면 그 순간 초기화되어 조회가 시작되지 않는다. 겸사겸사 화면의
 * 마커 수만큼 생기던 쿼리 구독도 하나로 줄어든다.
 */
export function useSpotClaim() {
  const { t, locale } = useTranslation();
  const [spotId, setSpotId] = useState<number | null>(null);
  // 탭 횟수. 조회 결과에 실려 마커까지 내려가 말풍선 열림 신호가 된다(SpotClaimState.openSeq 참고).
  const [openSeq, setOpenSeq] = useState(0);

  const { data, isError, refetch } = useQuery({
    queryKey: queryKeys.claims.spot(spotId ?? 0, locale),
    queryFn: () => fetchSpotClaim(spotId!, locale),
    enabled: spotId != null,
    // 점령 상태는 수시로 바뀌므로 탭할 때마다 항상 새로 받는다. 캐시를 남기면 다음 탭에서
    // 낡은 값이 먼저 보인다.
    staleTime: 0,
    gcTime: 0,
    // 실패 시 기본 3회 재시도는 말풍선이 뜨기까지 너무 오래 걸린다(백오프 포함 ~7초).
    retry: 1,
  });

  // 같은 마커를 다시 탭하면 id가 그대로라 쿼리가 저절로 다시 돌지 않으므로 명시적으로 refetch한다.
  const select = useCallback(
    (nextSpotId: number) => {
      setOpenSeq((seq) => seq + 1);
      if (nextSpotId === spotId) refetch();
      else setSpotId(nextSpotId);
    },
    [spotId, refetch],
  );

  // 재조회 중에도(직전 결과가 있으면) 문구를 유지한다. isFetching 동안 null로 떨어뜨리면
  // <Callout>이 언마운트되는데, 같은 마커를 다시 탭하는 순간엔 네이티브가 이미 그 Callout으로
  // 말풍선을 연 뒤라, 내용 뷰만 빠진 빈 흰 박스가 남는다. 한 번 뜬 마커의 Callout은 계속
  // 마운트해 두고, 다시 열지 말지는 위 openSeq가 정한다.
  const settled = spotId != null && (data !== undefined || isError);
  const claim: SpotClaimState | null = settled
    ? {
        spotId,
        text: isError
          ? t('map.claim.loadFailed')
          : data?.team
            ? t('map.claim.claimedBy', { team: data.team })
            : t('map.claim.unclaimed'),
        openSeq,
      }
    : null;

  return { claim, select };
}
