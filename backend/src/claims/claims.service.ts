import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SpotClaim } from './entities/spot-claim.entity';
import { DistrictClaim } from './entities/district-claim.entity';
import { DistrictClaimHistory } from './entities/district-claim-history.entity';
import { RedisService } from '../common/redis/redis.service';
import { UsersService } from '../users/users.service';
import { ScoresService } from '../scores/scores.service';
import { DistrictsService } from '../districts/districts.service';
import { ScoreEventType } from '../scores/entities/score-event.entity';
import { VisitDto } from './dto/visit.dto';

const DEFENSE_TTL = 300; // 5분
const DEFENSE_KEY = (spotId: number) => `defense:${spotId}`;

// 점령 점수 기본값 (가중치 곱하기 전). 개인 점수는 신규/재방문 동일, 팀 점수만 차등.
const PERSONAL_BASE = 100;
const TEAM_BASE_NEW = 100;
const TEAM_BASE_REVISIT = 30;

// 구 점령 판정 윈도우 (시간)
const AGGREGATION_WINDOW_HOURS = 12;

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);

  constructor(
    @InjectRepository(SpotClaim)
    private readonly spotClaimRepo: Repository<SpotClaim>,
    @InjectRepository(DistrictClaim)
    private readonly districtClaimRepo: Repository<DistrictClaim>,
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly usersService: UsersService,
    private readonly scoresService: ScoresService,
    private readonly districtsService: DistrictsService,
  ) {}

  async visit(dto: VisitDto, userId: string, team: string) {
    const { spotId, lat, lng } = dto;

    // 결투 패배 페널티 중에는 스팟 점령 시도 자체를 차단 (realtime/duels 모듈에서 설정하는 penalty:{userId} 키 재사용)
    // 사전 체크: 페널티 중인 유저의 요청을 빠르게 실패시켜 불필요한 방어 타이머 점유를 피한다.
    if (await this.redis.hasPenalty(userId)) {
      throw new ForbiddenException(
        '결투 패배 페널티 중에는 관광지를 점령할 수 없습니다.',
      );
    }

    // NULL 좌표 대비 CASE WHEN으로 안전하게 처리. 점수 가중치 계산용으로 sigungucode도 함께 조회.
    const result = await this.dataSource.query<
      {
        has_coords: boolean;
        within_range: boolean | null;
        distance: number | null;
        sigungucode: string | null;
      }[]
    >(
      `SELECT
         "mapX" IS NOT NULL AND "mapY" IS NOT NULL AS has_coords,
         CASE WHEN "mapX" IS NOT NULL AND "mapY" IS NOT NULL THEN
           ST_DWithin(
             ST_SetSRID(ST_MakePoint("mapX"::float, "mapY"::float), 4326)::geography,
             ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
             50
           )
         END AS within_range,
         CASE WHEN "mapX" IS NOT NULL AND "mapY" IS NOT NULL THEN
           ROUND(
             ST_Distance(
               ST_SetSRID(ST_MakePoint("mapX"::float, "mapY"::float), 4326)::geography,
               ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
             )::numeric, 1
           )::float8
         END AS distance,
         sigungucode
       FROM spots WHERE id = $3`,
      [lng, lat, spotId],
    );

    if (!result.length)
      throw new NotFoundException('관광지를 찾을 수 없습니다.');

    if (!result[0].has_coords)
      throw new BadRequestException(
        '해당 관광지는 좌표 정보가 없어 방문 인증이 불가합니다.',
      );

    const { within_range, distance, sigungucode } = result[0];
    if (!within_range) {
      throw new BadRequestException(
        `방문 인증 실패: 현재 위치가 ${distance}m 떨어져 있습니다. (허용: 50m 이내)`,
      );
    }

    // Lua 원자 연산으로 방어 체크 + 타이머 갱신을 단일 명령으로 처리
    // 신규 점령 시에만 타이머를 설정하고, 같은 팀 재방문은 타이머 리셋 없이 통과
    const defense = await this.redis.claimDefense(
      DEFENSE_KEY(spotId),
      team,
      DEFENSE_TTL,
    );
    if (defense.status === 'blocked') {
      throw new ConflictException(
        `방어 시간 중: ${defense.defenseTeam} 팀이 ${Math.max(0, defense.remaining)}초 동안 방어 중입니다.`,
      );
    }

    // 최종 재확인: 위 관광지 조회·방어 타이머 확인 사이(비동기 구간)에 결투 패배로 페널티가
    // 새로 걸렸을 수 있으므로, 실제 커밋 직전에 한 번 더 확인해 TOCTOU 창을 최소화한다.
    if (await this.redis.hasPenalty(userId)) {
      if (defense.created) {
        await this.redis.del(DEFENSE_KEY(spotId)).catch((redisErr) => {
          this.logger.error(
            `Redis 방어 키 롤백 실패 spotId=${spotId}`,
            redisErr,
          );
        });
      }
      throw new ForbiddenException(
        '결투 패배 페널티 중에는 관광지를 점령할 수 없습니다.',
      );
    }

    // 점령 처리 + 점수 지급을 한 트랜잭션으로 묶는다 — 실패 시 이번 요청에서 새로 만든 방어 키만 롤백
    // (같은 팀 재방문 시 기존 방어 타이머를 지우면 진행 중이던 방어가 무효화됨)
    let type: ScoreEventType;
    let personalPoints: number;
    let teamPoints: number;
    try {
      const weight = this.districtsService.getWeight(sigungucode);
      const outcome = await this.dataSource.transaction(async (manager) => {
        // 같은 유저·같은 관광지의 동시 요청(더블탭·재시도)을 직렬화한다.
        // 이 트랜잭션 잠금이 없으면 두 요청이 모두 "오늘 미채점"을 읽고 각각 점수를
        // 적립해 일일 1회 제한이 깨질 수 있다(READ COMMITTED). 트랜잭션 종료 시 자동 해제.
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `claim:${userId}:${spotId}`,
        ]);

        // 점령 직전 보유팀으로 신규/재방문 판정.
        // (교차팀 진입은 Redis 방어가, 동일 유저 동시성은 위 advisory lock이 직렬화한다.)
        const prev = await manager
          .getRepository(SpotClaim)
          .findOne({ where: { spotId } });
        const isRevisit = prev?.team === team;
        const eventType = isRevisit
          ? ScoreEventType.CLAIM_REVISIT
          : ScoreEventType.CLAIM_NEW;

        // 일일 제한: 오늘(KST) 이 관광지에서 이미 점수를 받았으면 점수 0 (방문/방어는 그대로 성공)
        const alreadyScored = await this.scoresService.hasClaimScoredToday(
          manager,
          userId,
          spotId,
        );
        const teamBase = isRevisit ? TEAM_BASE_REVISIT : TEAM_BASE_NEW;
        const personal = alreadyScored ? 0 : Math.round(PERSONAL_BASE * weight);
        const teamPts = alreadyScored ? 0 : Math.round(teamBase * weight);

        await manager
          .getRepository(SpotClaim)
          .upsert({ spotId, team, userId }, { conflictPaths: ['spotId'] });

        if (personal > 0 || teamPts > 0) {
          await this.scoresService.record(manager, {
            userId,
            team,
            type: eventType,
            personalPoints: personal,
            teamPoints: teamPts,
            spotId,
          });
          await this.usersService.applyScoreDelta(userId, personal, manager);
        }

        return { eventType, personal, teamPts };
      });
      type = outcome.eventType;
      personalPoints = outcome.personal;
      teamPoints = outcome.teamPts;
    } catch (err) {
      if (defense.created) {
        await this.redis.del(DEFENSE_KEY(spotId)).catch((redisErr) => {
          this.logger.error(
            `Redis 방어 키 롤백 실패 spotId=${spotId}`,
            redisErr,
          );
        });
      }
      throw err;
    }

    return {
      success: true,
      spotId,
      team,
      type,
      pointsAwarded: personalPoints,
      teamPointsAwarded: teamPoints,
      defenseSeconds: defense.remaining,
    };
  }

  async getSpotClaim(spotId: number) {
    const claim = await this.spotClaimRepo.findOne({ where: { spotId } });
    return {
      spotId,
      team: claim?.team ?? null,
      claimedAt: claim?.claimedAt ?? null,
    };
  }

  async getDistrictClaim(sigungucode: string) {
    const claim = await this.districtClaimRepo.findOne({
      where: { sigungucode },
    });
    return {
      sigungucode,
      team: claim?.team ?? null,
      teamScore: claim?.teamScore ?? 0,
      calculatedAt: claim?.calculatedAt ?? null,
    };
  }

  /**
   * 구 단위 점령 집계 — 최근 12시간 윈도우의 팀 점수 합산 기준으로 각 구의 보유팀을 판정한다.
   * 윈도우에 활동이 없는 구는 기존 보유팀을 그대로 유지한다(새로 뺏기 전까지 영토 보유).
   * 집계 후 현재 보유 중인 전체 구의 스냅샷을 이력 테이블에 append한다(명예의 전당 소스).
   */
  async aggregateDistricts() {
    const outcome = await this.dataSource.transaction(async (manager) => {
      // 기존 구 점령 현황 로드 — 동점 시 기존 보유팀 우선 처리에 사용.
      // 집계 판정과 동일 트랜잭션에서 읽어 스냅샷 일관성을 확보한다(동시 실행 대비).
      const currentHolders = await manager.getRepository(DistrictClaim).find();
      const holderMap = new Map(
        currentHolders.map((d) => [d.sigungucode, d.team]),
      );

      const rows = await this.scoresService.getTeamScoresByDistrict(
        manager,
        AGGREGATION_WINDOW_HOURS,
      );

      // 이번 윈도우의 (구, 팀) → 점수 조회용 — 이력 스냅샷에 실제 윈도우 점수를 남기기 위함.
      const windowScore = new Map<string, number>();
      for (const row of rows) {
        windowScore.set(
          `${row.sigungucode}:${row.team}`,
          Number(row.team_score),
        );
      }

      // 구별 최다 점수 팀 선정 (쿼리가 이미 sigungucode, 점수 DESC, 최초시각 ASC로 정렬).
      // 동점 시: 기존 보유팀 우선, 없으면 먼저 점수를 낸 팀.
      const winners = new Map<string, { team: string; teamScore: number }>();
      for (const row of rows) {
        const score = Number(row.team_score);
        const current = winners.get(row.sigungucode);
        if (!current) {
          winners.set(row.sigungucode, { team: row.team, teamScore: score });
        } else if (
          score === current.teamScore &&
          row.team === holderMap.get(row.sigungucode)
        ) {
          winners.set(row.sigungucode, { team: row.team, teamScore: score });
        }
      }

      // 활동 있는 구만 갱신 (활동 없는 구는 기존 보유 유지 — 삭제하지 않음)
      await Promise.all(
        [...winners.entries()].map(([sigungucode, { team, teamScore }]) =>
          manager.upsert(
            DistrictClaim,
            { sigungucode, team, teamScore },
            { conflictPaths: ['sigungucode'] },
          ),
        ),
      );

      // 갱신 후 현재 보유 중인 전체 구 스냅샷을 이력에 append.
      // teamScore는 저장된 값(과거 승리 시점 점수) 대신 '이번 윈도우에 해당 보유팀이 얻은
      // 점수'를 기록한다 — 활동 없는 보유 구는 0. 시계열 해석 시 오해를 막기 위함.
      const holders = await manager.getRepository(DistrictClaim).find();
      if (holders.length > 0) {
        await manager.insert(
          DistrictClaimHistory,
          holders.map((h) => ({
            sigungucode: h.sigungucode,
            team: h.team,
            teamScore: windowScore.get(`${h.sigungucode}:${h.team}`) ?? 0,
          })),
        );
      }

      return { updated: winners.size, snapshot: holders.length };
    });

    return {
      aggregated: outcome.updated,
      snapshot: outcome.snapshot,
    };
  }
}
