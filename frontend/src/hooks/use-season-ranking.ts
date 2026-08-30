import { useState } from 'react';
import { useIsFocused } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  fetchTeamRanking,
  fetchUserRanking,
  type SeasonStatus,
} from '@/api/ranking';
import { queryKeys } from '@/lib/query-keys';

// 시즌 랭킹 캐시 TTL(진행 중 60초, hall-of-fame.service.ts LIVE_TTL_SEC)에 맞춘 폴링 주기.
// 이보다 짧게 돌려도 백엔드가 같은 캐시 값을 돌려주므로 의미가 없다.
const SEASON_POLL_MS = 60_000;

export type RankingScope = 'teams' | 'users';

interface SeasonMeta {
  season: number;
  status: SeasonStatus;
}

/**
 * 화면이 포커스를 잃은 동안(다른 탭으로 이동)에는 폴링을 멈춘다. expo-router의 Tabs는
 * 방문한 화면을 언마운트하지 않아 이 조건이 없으면 탭을 나가도 refetchInterval이 계속
 * 돈다(PR #49 리뷰 지적 1번). 앱이 백그라운드로 가는 경우까지 막으려면 AppState→
 * focusManager 전역 배선이 별도로 필요한데, query-client.ts에 그 배선이 없어(리뷰가
 * 확인한 대로) 이 화면만으로는 커버할 수 없는 범위라 별도 과제로 남긴다.
 */
export function computeSeasonRefetchInterval(
  isFocused: boolean,
  selectedSeason: number | null,
  status: SeasonStatus | undefined,
): number | false {
  if (!isFocused) return false;
  return selectedSeason === null || status === 'ongoing' ? SEASON_POLL_MS : false;
}

/**
 * "진행 중"인 시즌이 곧 현재 시즌이다 — 이 판정만으로 폴링 여부와 "다음 시즌" 이동
 * 가능 여부를 모두 결정하면, 선택된 시즌 번호가 현재 시즌과 우연히 같아져도(예: 이전
 * 시즌들을 거쳐 next로 다시 돌아온 경우) selectedSeason이 null이 아닌데도 status만으로
 * isLiveSeason이 true가 되어 "현재로" 링크가 자연히 사라진다.
 *
 * displaySeason은 query.data가 아직 없을 때(scope 전환 직후 등, PR #49 리뷰 지적 3번)도
 * selectedSeason으로 시즌 라벨을 채워, 같은 시즌을 보고 있는데 라벨이 "—"로 잠깐
 * 떨어지는 것을 막는다. canGoPrevious/canGoNext는 서버가 확인해 준 상태에만 의존한다 —
 * 아직 로드되지 않은 데이터를 근거로 이동 가능 여부를 추측하면 실제 경계와 어긋날 수
 * 있기 때문이다.
 */
export function computeSeasonNavState(selectedSeason: number | null, data: SeasonMeta | undefined) {
  const resolvedSeason = data?.season ?? null;
  const status = data?.status;
  return {
    resolvedSeason,
    displaySeason: resolvedSeason ?? selectedSeason,
    isLiveSeason: selectedSeason === null || status === 'ongoing',
    canGoPrevious: resolvedSeason !== null && resolvedSeason > 1,
    canGoNext: status === 'ended',
  };
}

export function useSeasonRanking(scope: RankingScope) {
  const isFocused = useIsFocused();
  // null = 서버 기본값(현재 시즌). 과거 시즌을 탐색하면 명시적인 번호로 바뀐다.
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);

  const teamQuery = useQuery({
    queryKey: queryKeys.ranking.teams(selectedSeason ?? undefined),
    queryFn: () => fetchTeamRanking(selectedSeason ?? undefined),
    enabled: scope === 'teams',
    refetchInterval: (query) =>
      computeSeasonRefetchInterval(isFocused, selectedSeason, query.state.data?.status),
  });
  const userQuery = useQuery({
    queryKey: queryKeys.ranking.users(selectedSeason ?? undefined),
    queryFn: () => fetchUserRanking(selectedSeason ?? undefined),
    enabled: scope === 'users',
    refetchInterval: (query) =>
      computeSeasonRefetchInterval(isFocused, selectedSeason, query.state.data?.status),
  });

  const query = scope === 'teams' ? teamQuery : userQuery;
  const navState = computeSeasonNavState(selectedSeason, query.data);

  return {
    query,
    ...navState,
    goToPrevious: () => {
      if (navState.resolvedSeason !== null) setSelectedSeason(navState.resolvedSeason - 1);
    },
    goToNext: () => {
      if (navState.resolvedSeason !== null) setSelectedSeason(navState.resolvedSeason + 1);
    },
    backToCurrent: () => setSelectedSeason(null),
  };
}
