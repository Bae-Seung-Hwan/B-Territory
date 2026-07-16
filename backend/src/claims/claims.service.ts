import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Not, In } from 'typeorm';
import { SpotClaim } from './entities/spot-claim.entity';
import { DistrictClaim } from './entities/district-claim.entity';
import { RedisService } from '../common/redis/redis.service';
import { secondsUntilKstMidnight } from '../common/utils/kst.util';
import { VisitDto } from './dto/visit.dto';

const DEFENSE_TTL = 300; // 5분
const DEFENSE_KEY = (spotId: number) => `defense:${spotId}`;

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

    // NULL 좌표 대비 CASE WHEN으로 안전하게 처리
    const result = await this.dataSource.query<
      {
        has_coords: boolean;
        within_range: boolean | null;
        distance: number | null;
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
         END AS distance
       FROM spots WHERE id = $3`,
      [lng, lat, spotId],
    );

    if (!result.length)
      throw new NotFoundException('관광지를 찾을 수 없습니다.');

    if (!result[0].has_coords)
      throw new BadRequestException(
        '해당 관광지는 좌표 정보가 없어 방문 인증이 불가합니다.',
      );

    const { within_range, distance } = result[0];
    if (!within_range) {
      throw new BadRequestException(
        `방문 인증 실패: 현재 위치가 ${distance}m 떨어져 있습니다. (허용: 50m 이내)`,
      );
    }

    // 일일 점령 제한: 같은 관광지는 인당 하루 1회만 점령 가능 (KST 자정 리셋 —
    // 구 집계 크론과 같은 시계). SET NX가 확인과 기록을 원자로 처리한다.
    const daily = await this.redis.markDailyClaim(
      userId,
      spotId,
      secondsUntilKstMidnight(),
    );
    if (!daily.created) {
      throw new ConflictException(
        '이 관광지는 오늘 이미 점령했습니다. (KST 자정에 초기화)',
      );
    }

    try {
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
      // 새로 걸렸을 수 있으므로, 실제 커밋(upsert) 직전에 한 번 더 확인해 TOCTOU 창을 최소화한다.
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

      // 점령 처리 (upsert) — 실패 시 이번 요청에서 새로 만든 방어 키만 롤백
      // (같은 팀 재방문 시 기존 방어 타이머를 지우면 진행 중이던 방어가 무효화됨)
      try {
        await this.spotClaimRepo.upsert(
          { spotId, team, userId },
          { conflictPaths: ['spotId'] },
        );
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

      return { success: true, spotId, team, defenseSeconds: defense.remaining };
    } catch (err) {
      // 점령이 확정되지 않은 실패(방어 중, DB 오류 등)가 일일 횟수를 소진하지 않도록,
      // 이번 요청에서 새로 만든 일일 키만 롤백한다 (NX 성공 = 이번 요청이 만든 키)
      await this.redis.clearDailyClaim(userId, spotId).catch((redisErr) => {
        this.logger.error(
          `일일 점령 키 롤백 실패 userId=${userId} spotId=${spotId}`,
          redisErr,
        );
      });
      throw err;
    }
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
      spotCount: claim?.spotCount ?? 0,
      calculatedAt: claim?.calculatedAt ?? null,
    };
  }

  async aggregateDistricts() {
    // 기존 구 점령 현황 로드 — 동점 시 기존 보유팀 우선 처리에 사용
    const currentHolders = await this.districtClaimRepo.find();
    const holderMap = new Map(
      currentHolders.map((d) => [d.sigungucode, d.team]),
    );

    const rows = await this.dataSource.query<
      { sigungucode: string; team: string; spot_count: string }[]
    >(
      `SELECT
         s.sigungucode,
         sc.team,
         COUNT(*) AS spot_count
       FROM spot_claims sc
       JOIN spots s ON s.id = sc."spotId"
       WHERE s.sigungucode IS NOT NULL
       GROUP BY s.sigungucode, sc.team
       ORDER BY s.sigungucode, COUNT(*) DESC, MIN(sc."claimedAt") ASC`,
    );

    // 구 단위로 최다 점령 팀 선정
    // 동점 시: 기존 보유팀 우선, 보유팀 없으면 MIN(claimedAt) ASC 기준으로 먼저 점령한 팀
    const districtMap = new Map<string, { team: string; spotCount: number }>();
    for (const row of rows) {
      const count = Number(row.spot_count);
      const current = districtMap.get(row.sigungucode);
      if (!current) {
        districtMap.set(row.sigungucode, { team: row.team, spotCount: count });
      } else if (count > current.spotCount) {
        districtMap.set(row.sigungucode, { team: row.team, spotCount: count });
      } else if (
        count === current.spotCount &&
        row.team === holderMap.get(row.sigungucode)
      ) {
        // 동점 시 기존 보유팀 우선
        districtMap.set(row.sigungucode, { team: row.team, spotCount: count });
      }
    }

    await this.dataSource.transaction(async (manager) => {
      if (districtMap.size > 0) {
        await Promise.all(
          [...districtMap.entries()].map(([sigungucode, { team, spotCount }]) =>
            manager.upsert(
              DistrictClaim,
              { sigungucode, team, spotCount },
              { conflictPaths: ['sigungucode'] },
            ),
          ),
        );
        // 이번 배치에서 집계되지 않은 구 (점령자 없음) 제거
        await manager.delete(DistrictClaim, {
          sigungucode: Not(In([...districtMap.keys()])),
        });
      } else {
        await manager.delete(DistrictClaim, {});
      }
    });

    return { aggregated: districtMap.size };
  }
}
