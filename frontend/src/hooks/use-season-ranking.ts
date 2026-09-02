import { useState } from 'react';
import { useIsFocused } from 'expo-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  fetchTeamRanking,
  fetchUserRanking,
  type SeasonStatus,
} from '@/api/ranking';
import { queryKeys } from '@/lib/query-keys';

// 시즌 랭킹 캐시 TTL(진행 중 60초, hall-of-fame.service.ts LIVE_TTL_SEC)에 맞춘 폴링 주기.
// 이보다 짧게 돌려도 백엔드가 같은 캐시 값을 돌려주므로 의미가 없다. staleTime도 여기에
// 맞춰뒀다 — 없으면 탭을 오가며 리마운트할 때마다 같은 캐시 값을 다시 요청하게 된다
// (PR #49 2차 리뷰 지적).
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

/**
 * next로 이동한 곳이 현재 시즌 번호와 같아지면 명시적 번호가 아니라 null(= "current")로
 * 되돌린다. 그러지 않으면 같은 데이터가 queryKeys.ranking.*(undefined) === 'current' 키와
 * 명시적 시즌 번호 키 두 곳에 따로 캐시되어 각각 폴링을 돌게 된다(PR #49 2차 리뷰 지적).
 * currentSeasonNumber를 아직 모르면(현재 시즌을 한 번도 조회하지 못한 경우) 안전하게
 * 명시적 번호로 이동한다.
 */
export function resolveNextSeason(
  resolvedSeason: number,
  currentSeasonNumber: number | null,
): number | null {
  const next = resolvedSeason + 1;
  if (currentSeasonNumber !== null && next >= currentSeasonNumber) return null;
  return next;
}

export function useSeasonRanking(scope: RankingScope) {
  const isFocused = useIsFocused();
  // null = 서버 기본값(현재 시즌). 과거 시즌을 탐색하면 명시적인 번호로 바뀐다.
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [currentSeasonNumber, setCurrentSeasonNumber] = useState<number | null>(null);

  const teamQuery = useQuery({
    queryKey: queryKeys.ranking.teams(selectedSeason ?? undefined),
    queryFn: () => fetchTeamRanking(selectedSeason ?? undefined),
    enabled: scope === 'teams',
    staleTime: SEASON_POLL_MS,
    // 시즌 이동으로 쿼리키가 바뀌는 동안 직전 데이터를 유지한다 — 없으면 로딩 중
    // query.data가 undefined가 되어 canGoPrevious/canGoNext가 함께 꺼지고 화살표가
    // 둘 다 비활성화된다(PR #49 2차 리뷰 지적).
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      computeSeasonRefetchInterval(isFocused, selectedSeason, query.state.data?.status),
  });
  const userQuery = useQuery({
    queryKey: queryKeys.ranking.users(selectedSeason ?? undefined),
    queryFn: () => fetchUserRanking(selectedSeason ?? undefined),
    enabled: scope === 'users',
    staleTime: SEASON_POLL_MS,
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      computeSeasonRefetchInterval(isFocused, selectedSeason, query.state.data?.status),
  });

  const query = scope === 'teams' ? teamQuery : userQuery;
  const navState = computeSeasonNavState(selectedSeason, query.data);

  // selectedSeason이 null(현재 시즌)일 때 응답이 알려준 실제 시즌 번호를 기억해둔다 —
  // resolveNextSeason이 이 값과 비교해 "current" 키로 되돌아갈 시점을 판단한다. useEffect가
  // 아니라 렌더 중 조건부로 setState하는 이유는 리액트 문서가 권장하는 "prop/상태 변화에
  // 맞춰 다른 상태를 조정하는" 패턴이기 때문이다 — effect로 하면 커밋 이후 한 틱 늦게
  // 반영되어 그 사이에 goToNext가 눌리면 낡은 값을 참조하게 된다.
  if (selectedSeason === null && query.data && query.data.season !== currentSeasonNumber) {
    setCurrentSeasonNumber(query.data.season);
  }

  return {
    query,
    // 렌더 쪽에서 scope로 분기해 이 값을 직접 쓰면(FlatList의 data prop) TeamRankEntry/
    // UserRankEntry로 그대로 타입이 좁혀져, query.data.ranking을 as로 캐스팅할 필요가
    // 없어진다 — query는 scope에 따라 둘 중 하나로 정해지는 합집합 타입이라 그 자체로는
    // 좁혀지지 않는다(PR #49 2차 리뷰 지적).
    teamQuery,
    userQuery,
    ...navState,
    goToPrevious: () => {
      if (navState.resolvedSeason !== null) setSelectedSeason(navState.resolvedSeason - 1);
    },
    goToNext: () => {
      if (navState.resolvedSeason !== null) {
        setSelectedSeason(resolveNextSeason(navState.resolvedSeason, currentSeasonNumber));
      }
    },
    backToCurrent: () => setSelectedSeason(null),
  };
}
