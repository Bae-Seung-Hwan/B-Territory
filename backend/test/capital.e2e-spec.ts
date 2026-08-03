import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from '../src/app-setup';
import { FirebaseService } from '../src/common/firebase/firebase.service';
import { User } from '../src/users/entities/user.entity';
import { Spot } from '../src/spots/entities/spot.entity';
import { RedisService } from '../src/common/redis/redis.service';
import {
  DistrictsService,
  CAPITAL_MULTIPLIER,
} from '../src/districts/districts.service';

const mockFirebaseService = {
  verifyIdToken: (token: string) => Promise.resolve({ uid: token }),
};

// Busan City Hall 근방 좌표 (반경 50m 이내)
const SPOT_LAT = 35.1796;
const SPOT_LNG = 129.0756;

interface VisitSuccessBody {
  success: boolean;
  spotId: number;
  team: string;
  type: string;
  pointsAwarded: number;
  teamPointsAwarded: number;
  defenseSeconds: number;
}

interface CapitalBody {
  sigunguCode: string | null;
  multiplier: number;
  district: { sigunguCode: string } | null;
}

describe('Capital (e2e)', () => {
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let spotRepo: Repository<Spot>;
  let districtsService: DistrictsService;
  let redisService: RedisService;
  let dataSource: DataSource;
  let capitalCode: string;
  let capitalWeight: number;
  let capitalSpotId: number;
  let nonCapitalSpotId: number;
  // 시딩된 실제 구(해운대구=16, 가중치 > 1). 좌표 있는 spot을 여기에만 만들어
  // 수도 지정 후보를 이 구 하나로 좁힌다 → 무작위 지정이 결정적으로 이 구를 뽑는다.
  const capitalSigungucode = '16';
  // districts 미등록 코드 — 지정 후보(등록된 구)가 아니므로 절대 수도가 되지 않는 대조군
  const unregisteredSigungucode = '99CAP';

  // capital_designations도 truncate 대상에 포함 (직전 실행의 지정 이력이 남지 않게).
  // districts는 부팅 시 CSV 시딩된 레퍼런스라 제외한다.
  const truncateAll = () =>
    dataSource.query(
      'TRUNCATE TABLE "score_events", "district_claim_history", "spot_claims", "district_claims", "capital_designations", "users", "spots" RESTART IDENTITY CASCADE',
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FirebaseService)
      .useValue(mockFirebaseService)
      .compile();

    app = configureApp(moduleFixture.createNestApplication());
    await app.init();

    userRepo = moduleFixture.get(getRepositoryToken(User));
    spotRepo = moduleFixture.get(getRepositoryToken(Spot));
    districtsService = moduleFixture.get(DistrictsService);
    redisService = moduleFixture.get(RedisService);
    dataSource = moduleFixture.get(DataSource);

    await truncateAll();

    await userRepo.save([
      {
        firebaseUid: 'uid-capA',
        email: 'capA@test.com',
        nickname: 'Cap A',
        nationality: 'KR',
        team: 'A',
      },
      {
        firebaseUid: 'uid-capB',
        email: 'capB@test.com',
        nickname: 'Cap B',
        nationality: 'KR',
        team: 'B',
      },
    ]);

    // 좌표 있는 spot을 지정 후보 구(16)에 먼저 만든다 — 지정은 이런 spot을 가진 구 중에서만
    // 뽑으므로, 후보가 이 구 하나가 되어 무작위 지정이 결정적으로 16을 뽑는다.
    const capitalSpot = await spotRepo.save({
      contentId: 'cap-spot',
      title: '수도 관광지',
      mapX: SPOT_LNG,
      mapY: SPOT_LAT,
      sigungucode: capitalSigungucode,
    });
    capitalSpotId = capitalSpot.id;

    // 미등록 구의 관광지 — 지정 후보가 아니고(배수 미적용) 대조군으로만 쓴다.
    const nonCapitalSpot = await spotRepo.save({
      contentId: 'noncap-spot',
      title: '비수도 관광지',
      mapX: SPOT_LNG,
      mapY: SPOT_LAT,
      sigungucode: unregisteredSigungucode,
    });
    nonCapitalSpotId = nonCapitalSpot.id;

    // 방어 키(defense:<spotId>)는 spot ID로만 키잉되는데 spot ID가 RESTART IDENTITY로
    // 다른 e2e 스펙과 겹친다. 앞선 스펙(예: claims)이 같은 ID에 남긴 방어 키가 있으면
    // 이 스펙의 점령이 방어에 막혀 409가 나므로, 쓰기 전에 선제 정리한다(실행 순서 독립).
    await Promise.all([
      redisService.del(`defense:${capitalSpotId}`),
      redisService.del(`defense:${nonCapitalSpotId}`),
    ]);

    // 이번 주 수도를 지정한다. 후보가 16 하나뿐이라 결정적으로 16이 뽑힌다.
    const designated = await districtsService.designateWeeklyCapital();
    if (!designated) {
      throw new Error(
        '수도 지정 실패 — 후보 구가 없습니다(spot/CSV 시딩 확인).',
      );
    }
    capitalCode = designated.sigunguCode;
    capitalWeight = districtsService.getWeight(capitalCode);
  });

  afterAll(async () => {
    await truncateAll();
    // 점령이 남긴 방어 키(defense:<spotId>, TTL 5분)를 정리한다. spot ID는 RESTART IDENTITY로
    // 다른 e2e 스펙과 겹치므로, 지우지 않으면 다음 스펙의 같은 ID 점령이 방어에 막힌다.
    // 수도 공유 키(capital:current)도 지운다 — 남으면 다른 스펙의 같은 구 점령에 배수가 샌다.
    await Promise.all([
      redisService.del(`defense:${capitalSpotId}`),
      redisService.del(`defense:${nonCapitalSpotId}`),
      redisService.del('capital:current'),
    ]);
    await app.close();
  });

  it('지정은 좌표 있는 spot을 가진 구 중에서만 뽑는다 (후보=16)', () => {
    // 후보가 16 하나뿐이므로 무작위 지정이 결정적으로 16을 뽑아야 한다.
    expect(capitalCode).toBe(capitalSigungucode);
  });

  it('같은 주 재호출은 멱등 — 기존 수도를 유지한다 (Bull 재시도 대비)', async () => {
    const again = await districtsService.designateWeeklyCapital();
    expect(again?.sigunguCode).toBe(capitalCode);
    // 이력이 2건으로 늘지 않았는지 확인 (재지정 없이 skip)
    const count = await dataSource.query<{ count: string }[]>(
      'SELECT COUNT(*)::int AS count FROM capital_designations',
    );
    expect(Number(count[0].count)).toBe(1);
  });

  it('GET /districts/capital/current — 지정된 수도와 배수 반환', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/districts/capital/current')
      .expect(200);

    const body = res.body as CapitalBody;
    expect(body.sigunguCode).toBe(capitalCode);
    expect(body.multiplier).toBe(CAPITAL_MULTIPLIER);
    expect(body.district?.sigunguCode).toBe(capitalCode);
  });

  it('수도 지정 구 점령 → 점수에 수도 배수 적용 (구 가중치 × 수도 배수)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/claims/visit')
      .set('Authorization', 'Bearer uid-capA')
      .send({ spotId: capitalSpotId, lat: SPOT_LAT, lng: SPOT_LNG })
      .expect(201);

    const body = res.body as VisitSuccessBody;
    // 점수 = round(기본 100 × 구 가중치 × 수도 배수). 개인·팀 동일(신규 점령 base 100/100).
    const expected = Math.round(100 * capitalWeight * CAPITAL_MULTIPLIER);
    const withoutCapital = Math.round(100 * capitalWeight);
    expect(body.pointsAwarded).toBe(expected);
    expect(body.teamPointsAwarded).toBe(expected);
    // 배수가 실제로 점수를 끌어올렸는지 (가중치만 적용했을 때보다 큼)
    expect(expected).toBeGreaterThan(withoutCapital);
  });

  it('수도가 아닌 구 점령 → 배수 미적용 (기본 100점)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/claims/visit')
      .set('Authorization', 'Bearer uid-capB')
      .send({ spotId: nonCapitalSpotId, lat: SPOT_LAT, lng: SPOT_LNG })
      .expect(201);

    const body = res.body as VisitSuccessBody;
    // 99CAP은 미등록 → 가중치 1.0, 수도 아님 → 배수 1.0 → 정확히 100점
    expect(body.pointsAwarded).toBe(100);
    expect(body.teamPointsAwarded).toBe(100);
  });

  it('동시 지정 경합 → weekStart UNIQUE로 정확히 1행만 확정, Redis도 DB와 일치 (유령 수도 방지)', async () => {
    // 이번 주 이력·Redis 캐시를 비우고 여러 지정을 동시에 실행한다. 예전 구현(Redis 주 락으로
    // 승자 결정)에선 락만 잡히고 DB insert가 없는 "유령 수도"가 생길 수 있었다. 이제 승자는
    // weekStart UNIQUE insert 성공으로만 결정되므로, 경합 패자는 unique 위반 경로로 확정된
    // 행을 채택하고 DB엔 정확히 1행만 남아야 한다 — Redis는 항상 그 DB 상태를 뒤따른다.
    await dataSource.query(
      'TRUNCATE TABLE "capital_designations" RESTART IDENTITY',
    );
    await redisService.del('capital:current');

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        districtsService.designateWeeklyCapital(),
      ),
    );

    // 후보가 16 하나뿐이라 경합자 전원이 16을 확정해야 한다.
    for (const r of results) expect(r?.sigunguCode).toBe(capitalSigungucode);

    // DB엔 이번 주 이력이 정확히 1행 — 경합 패자는 insert하지 않는다.
    const count = await dataSource.query<{ count: string }[]>(
      'SELECT COUNT(*)::int AS count FROM capital_designations',
    );
    expect(Number(count[0].count)).toBe(1);

    // Redis 현재값이 DB 확정 수도와 일치 — 락만 잡히고 DB엔 없는 유령 수도가 아니다.
    const dbRow = await dataSource.query<{ sigunguCode: string }[]>(
      'SELECT "sigunguCode" FROM capital_designations LIMIT 1',
    );
    const redisCurrent = await redisService.get('capital:current');
    expect(redisCurrent).toBe(dbRow[0].sigunguCode);
    expect(redisCurrent).toBe(capitalSigungucode);
  });
});
