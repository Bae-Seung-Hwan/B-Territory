import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useSeasonRanking,
  computeSeasonNavState,
  computeSeasonRefetchInterval,
  resolveNextSeason,
} from '@/hooks/use-season-ranking';
import { fetchTeamRanking, fetchUserRanking } from '@/api/ranking';

jest.mock('@/api/ranking', () => ({
  fetchTeamRanking: jest.fn(),
  fetchUserRanking: jest.fn(),
}));

jest.mock('expo-router', () => ({ useIsFocused: jest.fn(() => true) }));

const mockedFetchTeamRanking = fetchTeamRanking as jest.Mock;
const mockedFetchUserRanking = fetchUserRanking as jest.Mock;

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('computeSeasonNavState', () => {
  it('시즌 1에서는 이전으로 이동할 수 없다', () => {
    expect(computeSeasonNavState(null, { season: 1, status: 'ongoing' }).canGoPrevious).toBe(
      false,
    );
  });

  it('시즌이 2 이상이면 이전으로 이동할 수 있다', () => {
    expect(computeSeasonNavState(null, { season: 2, status: 'ongoing' }).canGoPrevious).toBe(
      true,
    );
  });

  it('종료된 시즌에서만 다음으로 이동할 수 있다', () => {
    expect(computeSeasonNavState(3, { season: 3, status: 'ended' }).canGoNext).toBe(true);
    expect(computeSeasonNavState(3, { season: 3, status: 'ongoing' }).canGoNext).toBe(false);
    expect(computeSeasonNavState(3, { season: 3, status: 'upcoming' }).canGoNext).toBe(false);
  });

  it('selectedSeason이 null이면 현재 시즌으로 본다', () => {
    expect(computeSeasonNavState(null, { season: 5, status: 'ongoing' }).isLiveSeason).toBe(
      true,
    );
  });

  it('과거 시즌들을 거쳐 next로 현재(ongoing) 시즌에 돌아오면 selectedSeason이 null이 아니어도 현재 시즌으로 본다 (PR #49 리뷰 지적 2번의 회귀 케이스)', () => {
    // selectedSeason은 구체적인 번호(5)지만, 그 시즌이 실제로 ongoing이라면(현재 시즌과
    // 우연히 같아짐) "현재로" 링크가 사라져야 한다.
    expect(computeSeasonNavState(5, { season: 5, status: 'ongoing' }).isLiveSeason).toBe(true);
  });

  it('과거(ended) 시즌을 보고 있으면 현재 시즌이 아니다', () => {
    expect(computeSeasonNavState(3, { season: 3, status: 'ended' }).isLiveSeason).toBe(false);
  });

  it('query.data가 아직 없어도 selectedSeason으로 시즌 라벨을 채운다 (PR #49 리뷰 지적 3번)', () => {
    // scope 전환 직후 반대쪽 쿼리의 캐시가 없어 data가 undefined일 수 있는데, 그래도
    // 이미 알고 있는 selectedSeason으로 라벨을 채워야 "—"로 잠깐 떨어지지 않는다.
    expect(computeSeasonNavState(5, undefined).displaySeason).toBe(5);
  });

  it('selectedSeason도 없고 data도 없으면 표시할 시즌이 없다', () => {
    expect(computeSeasonNavState(null, undefined).displaySeason).toBeNull();
  });
});

describe('computeSeasonRefetchInterval', () => {
  it('화면이 포커스를 잃으면 폴링하지 않는다 (PR #49 리뷰 지적 1번)', () => {
    expect(computeSeasonRefetchInterval(false, null, 'ongoing')).toBe(false);
  });

  it('포커스 상태에서 현재 시즌(selectedSeason=null)이면 폴링한다', () => {
    expect(computeSeasonRefetchInterval(true, null, undefined)).toBe(60_000);
  });

  it('포커스 상태에서 진행 중(ongoing) 시즌을 보고 있어도 폴링한다', () => {
    expect(computeSeasonRefetchInterval(true, 5, 'ongoing')).toBe(60_000);
  });

  it('포커스 상태여도 종료된 시즌은 폴링하지 않는다', () => {
    expect(computeSeasonRefetchInterval(true, 3, 'ended')).toBe(false);
  });
});

describe('resolveNextSeason', () => {
  it('현재 시즌 번호를 모르면 안전하게 명시적 번호로 이동한다', () => {
    expect(resolveNextSeason(3, null)).toBe(4);
  });

  it('다음 시즌이 현재 시즌보다 작으면 명시적 번호로 이동한다', () => {
    expect(resolveNextSeason(3, 10)).toBe(4);
  });

  it('다음 시즌이 현재 시즌과 같아지면 null(current)로 되돌린다 (PR #49 2차 리뷰 지적)', () => {
    expect(resolveNextSeason(4, 5)).toBeNull();
  });

  it('다음 시즌이 현재 시즌을 넘어서도 null(current)로 되돌린다', () => {
    expect(resolveNextSeason(5, 5)).toBeNull();
  });
});

describe('useSeasonRanking', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("scope가 'teams'면 팀 랭킹 API만 호출한다", async () => {
    mockedFetchTeamRanking.mockResolvedValue({
      season: 5,
      status: 'ongoing',
      start: '2026-01-01',
      end: '2026-02-01',
      ranking: [],
    });
    queryClient = createQueryClient();
    const { result } = await renderHook(() => useSeasonRanking('teams'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.query.data).toBeDefined());
    expect(mockedFetchTeamRanking).toHaveBeenCalledWith(undefined);
    expect(mockedFetchUserRanking).not.toHaveBeenCalled();
  });

  it("scope가 'users'면 개인 랭킹 API만 호출한다", async () => {
    mockedFetchUserRanking.mockResolvedValue({
      season: 5,
      status: 'ongoing',
      start: '2026-01-01',
      end: '2026-02-01',
      ranking: [],
    });
    queryClient = createQueryClient();
    const { result } = await renderHook(() => useSeasonRanking('users'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.query.data).toBeDefined());
    expect(mockedFetchUserRanking).toHaveBeenCalledWith(undefined);
    expect(mockedFetchTeamRanking).not.toHaveBeenCalled();
  });

  it('next로 현재 시즌 번호에 도달하면 selectedSeason이 null로 정규화되어 이중 캐시를 피한다 (PR #49 2차 리뷰 지적)', async () => {
    // 현재 시즌은 5. 시즌 3(ended)을 보다가 next를 두 번 눌러 5(ongoing)에 도달하면,
    // queryKeys.ranking.teams(5)가 아니라 다시 'current' 키(undefined)로 돌아가야
    // 같은 데이터가 두 키에 중복 캐시되어 각각 폴링하는 일이 없다.
    mockedFetchTeamRanking.mockImplementation((season?: number) => {
      if (season === undefined || season === 5) {
        return Promise.resolve({
          season: 5,
          status: 'ongoing',
          start: '2026-01-01',
          end: '2026-02-01',
          ranking: [],
        });
      }
      return Promise.resolve({
        season,
        status: 'ended',
        start: '2026-01-01',
        end: '2026-02-01',
        ranking: [],
      });
    });
    queryClient = createQueryClient();
    const { result } = await renderHook(() => useSeasonRanking('teams'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.resolvedSeason).toBe(5));

    await act(async () => result.current.goToPrevious());
    await waitFor(() => expect(result.current.resolvedSeason).toBe(4));
    await act(async () => result.current.goToPrevious());
    await waitFor(() => expect(result.current.resolvedSeason).toBe(3));

    await act(async () => result.current.goToNext());
    await waitFor(() => expect(result.current.resolvedSeason).toBe(4));
    await act(async () => result.current.goToNext());

    await waitFor(() => expect(result.current.isLiveSeason).toBe(true));
    expect(mockedFetchTeamRanking).not.toHaveBeenCalledWith(5);
  });
});
