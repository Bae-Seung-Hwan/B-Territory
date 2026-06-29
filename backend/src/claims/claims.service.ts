import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SpotClaim } from './entities/spot-claim.entity';
import { DistrictClaim } from './entities/district-claim.entity';
import { RedisService } from '../common/redis/redis.service';
import { VisitDto } from './dto/visit.dto';

const DEFENSE_TTL = 300; // 5분
const DEFENSE_KEY = (spotId: number) => `defense:${spotId}`;

@Injectable()
export class ClaimsService {
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

    // NULL 좌표 대비 CASE WHEN으로 안전하게 처리
    const result = await this.dataSource.query<
      { has_coords: boolean; within_range: boolean | null; distance: number | null }[]
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

    // 점령 처리 (upsert) — 실패 시 Redis 방어 키 롤백
    try {
      await this.spotClaimRepo.upsert(
        { spotId, team, userId },
        { conflictPaths: ['spotId'] },
      );
    } catch (err) {
      await this.redis.del(DEFENSE_KEY(spotId)).catch(() => {});
      throw err;
    }

    return { success: true, spotId, team, defenseSeconds: defense.remaining };
  }

  async getSpotClaim(spotId: number) {
    const claim = await this.spotClaimRepo.findOne({ where: { spotId } });
    if (!claim) return { spotId, team: null, claimedAt: null };
    return claim;
  }

  async getDistrictClaim(sigungucode: string) {
    const claim = await this.districtClaimRepo.findOne({ where: { sigungucode } });
    if (!claim) return { sigungucode, team: null, calculatedAt: null };
    return claim;
  }

  async aggregateDistricts() {
    const rows = await this.dataSource.query<
      { sigungucode: string; team: string; spot_count: string }[]
    >(
      `SELECT
         s.sigungucode,
         sc.team,
         COUNT(*) AS spot_count
       FROM spot_claims sc
       JOIN spots s ON s.id = sc."spotId"
       GROUP BY s.sigungucode, sc.team
       ORDER BY s.sigungucode, COUNT(*) DESC, MIN(sc."claimedAt") ASC`,
    );

    // 구 단위로 최다 점령 팀 선정
    // 동점 시: SQL ORDER BY MIN(claimedAt) ASC 기준으로 먼저 점령한 팀이 우선됨
    const districtMap = new Map<string, { team: string; spotCount: number }>();
    for (const row of rows) {
      const count = Number(row.spot_count);
      const current = districtMap.get(row.sigungucode);
      if (!current || count > current.spotCount) {
        districtMap.set(row.sigungucode, { team: row.team, spotCount: count });
      }
    }

    await this.dataSource.transaction(async (manager) => {
      await Promise.all(
        [...districtMap.entries()].map(([sigungucode, { team, spotCount }]) =>
          manager.upsert(
            DistrictClaim,
            { sigungucode, team, spotCount },
            { conflictPaths: ['sigungucode'] },
          ),
        ),
      );
    });

    return { aggregated: districtMap.size };
  }
}
