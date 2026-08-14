import { apiClient } from '@/lib/api-client';

interface RankedEntry {
  rank: number;
}

export interface TeamRankEntry extends RankedEntry {
  team: string;
  score: number;
}

export interface UserRankEntry extends RankedEntry {
  userId: string;
  nickname: string;
  team: string;
  score: number;
}

type SeasonStatus = 'upcoming' | 'ongoing' | 'ended';

export interface RankingResult<T> {
  season: number;
  status: SeasonStatus;
  start: string;
  end: string;
  ranking: T[];
}

export interface TeamOccupationRecord {
  team: string;
  sigungucode: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
}

export interface TeamDuelWinRecord {
  team: string;
  wins: number;
}

export interface TeamRecords {
  longestOccupation: TeamOccupationRecord[];
  mostDuelWins: TeamDuelWinRecord[];
}

export interface UserCountRecord {
  userId: string;
  nickname: string;
  team: string;
  count: number;
}

export interface UserWinRateRecord {
  userId: string;
  nickname: string;
  team: string;
  wins: number;
  losses: number;
  winRate: number;
}

export interface UserRecords {
  mostVisits: UserCountRecord[];
  mostMissions: UserCountRecord[];
  duelWinRate: UserWinRateRecord[];
}

/** GET /api/hall-of-fame/teams — 시즌 팀 랭킹 (season 생략 시 현재 시즌). */
export async function fetchTeamRanking(
  season?: number,
): Promise<RankingResult<TeamRankEntry>> {
  const { data } = await apiClient.get<RankingResult<TeamRankEntry>>(
    '/api/hall-of-fame/teams',
    { params: season !== undefined ? { season } : undefined },
  );
  return data;
}

/** GET /api/hall-of-fame/users — 시즌 개인 랭킹 (season 생략 시 현재 시즌). */
export async function fetchUserRanking(
  season?: number,
): Promise<RankingResult<UserRankEntry>> {
  const { data } = await apiClient.get<RankingResult<UserRankEntry>>(
    '/api/hall-of-fame/users',
    { params: season !== undefined ? { season } : undefined },
  );
  return data;
}

/** GET /api/hall-of-fame/records/teams — 국가(팀) 역대 기록. 시즌 무관. */
export async function fetchTeamRecords(): Promise<TeamRecords> {
  const { data } = await apiClient.get<TeamRecords>('/api/hall-of-fame/records/teams');
  return data;
}

/** GET /api/hall-of-fame/records/users — 개인 역대 기록. 시즌 무관. */
export async function fetchUserRecords(): Promise<UserRecords> {
  const { data } = await apiClient.get<UserRecords>('/api/hall-of-fame/records/users');
  return data;
}
