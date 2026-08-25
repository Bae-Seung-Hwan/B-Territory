import { Injectable, Logger } from '@nestjs/common';
import {
  ScoresService,
  ScoreRange,
  TeamRankEntry,
  UserRankEntry,
} from '../scores/scores.service';
import { RedisService } from '../common/redis/redis.service';
import { seasonIndexOf, seasonRange } from '../common/utils/kst.util';
import {
  readJsonCache,
  writeJsonCache,
} from '../common/utils/redis-cache.util';

// 랭킹 상위 노출 수.
const RANK_LIMIT = 100;
// 진행 중/예정 시즌은 점수가 계속 바뀌므로 짧게, 종료된 시즌은 불변(append-only 원장)이라 길게 캐시.
const LIVE_TTL_SEC = 60;
const DONE_TTL_SEC = 24 * 60 * 60;

type SeasonStatus = 'upcoming' | 'ongoing' | 'ended';

export interface RankedEntry {
  rank: number;
}

export interface RankingResult<T> {
  season: number;
  status: SeasonStatus;
  start: string;
  end: string;
  ranking: (T & RankedEntry)[];
}

@Injectable()
export class HallOfFameService {
  private readonly logger = new Logger(HallOfFameService.name);

  constructor(
    private readonly scores: ScoresService,
    private readonly redis: RedisService,
  ) {}

  getTeams(season?: number): Promise<RankingResult<TeamRankEntry>> {
    return this.getRanking('teams', season, (range) =>
      this.scores.getTeamRanking(range, RANK_LIMIT),
    );
  }

  getUsers(season?: number): Promise<RankingResult<UserRankEntry>> {
    return this.getRanking('users', season, (range) =>
      this.scores.getUserRanking(range, RANK_LIMIT),
    );
  }

  // 생략 시 현재 시즌. pre-season(0)이면 시즌 1(예정)을 기본으로 노출한다.
  private resolveSeason(season?: number): number {
    if (season !== undefined) return season;
    return Math.max(seasonIndexOf(new Date()), 1);
  }

  private seasonStatus(range: ScoreRange, now: number): SeasonStatus {
    if (now < range.start.getTime()) return 'upcoming';
    if (now >= range.end.getTime()) return 'ended';
    return 'ongoing';
  }

  private async getRanking<T>(
    kind: 'teams' | 'users',
    season: number | undefined,
    fetch: (range: ScoreRange) => Promise<T[]>,
  ): Promise<RankingResult<T>> {
    const idx = this.resolveSeason(season);
    const range = seasonRange(idx);
    const cacheKey = `hof:${kind}:${idx}`;

    // 캐시는 순수한 가속 장치다 — 랭킹은 DB만으로 계산되므로 Redis 장애를 미스로 흡수하고
    // 조회를 계속한다. 감싸지 않으면 Redis가 죽었을 때 랭킹 API가 통째로 500이 된다.
    const cached = await readJsonCache<RankingResult<T>>(
      this.redis,
      cacheKey,
      this.logger,
    );
    if (cached !== null) return cached;

    const now = Date.now();
    const entries = await fetch(range);
    const result: RankingResult<T> = {
      season: idx,
      status: this.seasonStatus(range, now),
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      ranking: entries.map((e, i) => ({ ...e, rank: i + 1 })),
    };

    // 종료된 시즌은 원장이 불변이라 오래 캐시, 진행 중/예정은 짧게.
    const ttl = now >= range.end.getTime() ? DONE_TTL_SEC : LIVE_TTL_SEC;
    await writeJsonCache(this.redis, cacheKey, result, ttl, this.logger);
    return result;
  }
}
