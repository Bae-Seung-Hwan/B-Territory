import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
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

    // PostGIS로 50m 이내 여부 + 거리 계산
    const result = await this.dataSource.query<
      { within_range: boolean; distance: number }[]
    >(
      `SELECT
         ST_DWithin(
           ST_SetSRID(ST_MakePoint("mapX"::float, "mapY"::float), 4326)::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           50
         ) AS within_range,
         ROUND(
           ST_Distance(
             ST_SetSRID(ST_MakePoint("mapX"::float, "mapY"::float), 4326)::geography,
             ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
           )::numeric, 1
         ) AS distance
       FROM spots WHERE id = $3`,
      [lng, lat, spotId],
    );

    if (!result.length) throw new NotFoundException('관광지를 찾을 수 없습니다.');

    const { within_range, distance } = result[0];
    if (!within_range) {
      throw new BadRequestException(
        `방문 인증 실패: 현재 위치가 ${distance}m 떨어져 있습니다. (허용: 50m 이내)`,
      );
    }

    // 방어 시간 체크 (GET + TTL 단일 파이프라인)
    const { value: defenseTeam, ttl: remaining } = await this.redis.getWithTtl(
      DEFENSE_KEY(spotId),
    );
    if (defenseTeam && defenseTeam !== team) {
      throw new ConflictException(
        `방어 시간 중: ${defenseTeam} 팀이 ${Math.max(0, remaining)}초 동안 방어 중입니다.`,
      );
    }

    // 점령 처리 (upsert)
    await this.spotClaimRepo.upsert(
      { spotId, team, userId },
      { conflictPaths: ['spotId'] },
    );

    // 방어 타이머 갱신
    await this.redis.set(DEFENSE_KEY(spotId), team, DEFENSE_TTL);

    return { success: true, spotId, team, defenseSeconds: DEFENSE_TTL };
  }

  async getSpotClaim(spotId: number) {
    const claim = await this.spotClaimRepo.findOne({ where: { spotId } });
    if (!claim) return { spotId, team: null, claimedAt: null };
    return claim;
  }

  async getDistrictClaim(sigungucode: string) {
    return this.districtClaimRepo.findOne({ where: { sigungucode } });
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
       GROUP BY s.sigungucode, sc.team`,
    );

    // 구 단위로 최다 점령 팀 선정
    const districtMap = new Map<
      string,
      { team: string; spotCount: number }
    >();
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
