import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
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

@Injectable()
export class ScoresService {
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
}
