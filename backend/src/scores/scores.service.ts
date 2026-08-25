import { Injectable } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ScoreEvent, ScoreEventType } from './entities/score-event.entity';

export interface RecordScoreInput {
  userId: string;
  team: string;
  type: ScoreEventType;
  personalPoints: number;
  teamPoints: number;
  spotId?: number | null;
  duelId?: number | null;
}

export interface DistrictTeamScore {
  sigungucode: string;
  team: string;
  team_score: string; // pg SUM은 문자열로 반환
}

export interface TeamRankEntry {
  team: string;
  score: number;
}

export interface UserRankEntry {
  userId: string;
  nickname: string;
  team: string;
  score: number;
}

export interface ScoreRange {
  start: Date;
  end: Date;
}

@Injectable()
export class ScoresService {
  constructor(
    // 랭킹 조회(트랜잭션 밖 읽기)용. record/집계는 여전히 호출자 manager를 사용한다.
    @InjectRepository(ScoreEvent)
    private readonly scoreRepo: Repository<ScoreEvent>,
  ) {}

  /** 원장에 이벤트 1건 append (호출자 트랜잭션에 참여). */
  async record(manager: EntityManager, input: RecordScoreInput): Promise<void> {
    await manager.insert(ScoreEvent, {
      userId: input.userId,
      team: input.team,
      type: input.type,
      personalPoints: input.personalPoints,
      teamPoints: input.teamPoints,
      spotId: input.spotId ?? null,
      duelId: input.duelId ?? null,
    });
  }

  /**
   * 최근 windowHours 시간 동안 구별·팀별 팀 점수 합산.
   * 팀 점수(teamPoints) + 점령 이벤트(CLAIM_*)만 집계한다.
   * 동점 tie-break를 위해 팀별 최초 이벤트 시각도 함께 정렬한다.
   */
  async getTeamScoresByDistrict(
    manager: EntityManager,
    windowHours: number,
  ): Promise<DistrictTeamScore[]> {
    return manager.query<DistrictTeamScore[]>(
      `SELECT s.sigungucode, se.team, SUM(se."teamPoints") AS team_score
         FROM score_events se
         JOIN spots s ON s.id = se."spotId"
        WHERE se.type IN ('CLAIM_NEW', 'CLAIM_REVISIT')
          AND se."createdAt" >= NOW() - ($1 || ' hours')::interval
          AND s.sigungucode IS NOT NULL
        GROUP BY s.sigungucode, se.team
        ORDER BY s.sigungucode, SUM(se."teamPoints") DESC, MIN(se."createdAt") ASC`,
      [String(windowHours)],
    );
  }

  /**
   * 시즌 구간 [start, end)의 팀 랭킹 — 팀 점수(teamPoints, 점령 이벤트만) 합산 상위.
   * 순 0점 이하 팀은 제외. 동점은 team 코드 오름차순으로 결정적 정렬.
   */
  async getTeamRanking(
    range: ScoreRange,
    limit: number,
  ): Promise<TeamRankEntry[]> {
    const rows = await this.scoreRepo.query<{ team: string; score: string }[]>(
      `SELECT se.team AS team, SUM(se."teamPoints") AS score
         FROM score_events se
        WHERE se.type IN ('CLAIM_NEW', 'CLAIM_REVISIT')
          AND se."createdAt" >= $1 AND se."createdAt" < $2
        GROUP BY se.team
       HAVING SUM(se."teamPoints") > 0
        ORDER BY SUM(se."teamPoints") DESC, se.team ASC
        LIMIT $3`,
      [range.start, range.end, limit],
    );
    return rows.map((r) => ({ team: r.team, score: Number(r.score) }));
  }

  /**
   * 시즌 구간 [start, end)의 개인 랭킹 — 개인 점수(personalPoints, 전 이벤트) 합산 상위.
   * users와 INNER JOIN하므로 탈퇴(userId NULL)한 유저는 제외. 순 0점 이하 제외.
   * 동점은 nickname 오름차순으로 결정적 정렬.
   */
  async getUserRanking(
    range: ScoreRange,
    limit: number,
  ): Promise<UserRankEntry[]> {
    const rows = await this.scoreRepo.query<
      { userId: string; nickname: string; team: string; score: string }[]
    >(
      `SELECT se."userId" AS "userId", u.nickname AS nickname, u.team AS team,
              SUM(se."personalPoints") AS score
         FROM score_events se
         JOIN users u ON u.id = se."userId"
        WHERE se."createdAt" >= $1 AND se."createdAt" < $2
        GROUP BY se."userId", u.nickname, u.team
       HAVING SUM(se."personalPoints") > 0
        ORDER BY SUM(se."personalPoints") DESC, u.nickname ASC, se."userId" ASC
        LIMIT $3`,
      [range.start, range.end, limit],
    );
    return rows.map((r) => ({
      userId: r.userId,
      nickname: r.nickname,
      team: r.team,
      score: Number(r.score),
    }));
  }
}
