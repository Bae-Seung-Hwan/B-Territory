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
import { startOfKstWeek } from '../src/common/utils/kst.util';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
  // 직전 주 제외 검증용 두 번째 후보 구(중구=15) — 필요한 테스트에서만 spot을 만든다.
  const altSigungucode = '15';
  // districts 미등록 코드 — 지정 후보(등록된 구)가 아니므로 절대 수도가 되지 않는 대조군
  const unregisteredSigungucode = '99CAP';

  // capital_designations도 truncate 대상에 포함 (직전 실행의 지정 이력이 남지 않게).
  // districts는 부팅 시 CSV 시딩된 레퍼런스라 제외한다.
  const truncateAll = () =>
    dataSource.query(
      'TRUNCATE TABLE "score_events", "district_claim_history", "spot_claims", "district_claims", "capital_designations", "users", "spots" RESTART IDENTITY CASCADE',
    );

  // 수도 공유 캐시는 주 단위로 스코프되고(주가 바뀌면 지난주 값이 읽히지 않게), 원장 식별자로도
  // 스코프된다(여러 환경이 한 Redis를 공유해도 서로의 캐시를 읽지 않게). 키 구성이 서비스와
  // 어긋나면 이 스펙이 엉뚱한 키를 지우게 되므로 서비스의 키 빌더를 그대로 쓴다.
  const weekKey = (d: Date = new Date()): Promise<string> =>
    districtsService.capitalCacheKey(startOfKstWeek(d));

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
    // 부팅 시 catch-up이 이번 주 수도를 지정했을 수 있으므로(다른 스펙이 남긴 spot 기준),
    // 원장과 함께 공유 캐시도 비워 이 스펙이 깨끗한 상태에서 시작하게 한다.
    await redisService.del(await weekKey());

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
    // 이번 주 수도 공유 키도 지운다 — 남으면 다른 스펙의 같은 구 점령에 배수가 샌다.
    await Promise.all([
      redisService.del(`defense:${capitalSpotId}`),
      redisService.del(`defense:${nonCapitalSpotId}`),
      redisService.del(await weekKey()),
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

  it('Redis 도달 불가여도 DB 원장으로 폴백해 조회가 성공한다', async () => {
    // 리뷰 지적 재현: "Redis 미스"(연결됨·키 없음 → null)와 "Redis 도달 불가"(예외)는 다르다.
    // 후자를 감싸지 않으면 MaxRetriesPerRequestError가 그대로 올라가 DB 폴백에 도달조차
    // 못 하고 500이 된다. get/set 둘 다 실패시켜 폴백 경로 전체를 확인한다.
    const err = new Error(
      'Reached the max retries per request limit (which is 3).',
    );
    const getSpy = jest.spyOn(redisService, 'get').mockRejectedValue(err);
    const setSpy = jest.spyOn(redisService, 'set').mockRejectedValue(err);
    try {
      const res = await request(app.getHttpServer())
        .get('/api/districts/capital/current')
        .expect(200);

      const body = res.body as CapitalBody;
      expect(body.sigunguCode).toBe(capitalCode);
      expect(body.multiplier).toBe(CAPITAL_MULTIPLIER);
      expect(getSpy).toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
      setSpy.mockRestore();
    }
  });

  it('동시 지정 경합 → weekStart UNIQUE로 정확히 1행만 확정, Redis도 DB와 일치 (유령 수도 방지)', async () => {
    // 이번 주 이력·Redis 캐시를 비우고 여러 지정을 동시에 실행한다. 예전 구현(Redis 주 락으로
    // 승자 결정)에선 락만 잡히고 DB insert가 없는 "유령 수도"가 생길 수 있었다. 이제 승자는
    // weekStart UNIQUE insert 성공으로만 결정되므로, 경합 패자는 unique 위반 경로로 확정된
    // 행을 채택하고 DB엔 정확히 1행만 남아야 한다 — Redis는 항상 그 DB 상태를 뒤따른다.
    await dataSource.query(
      'TRUNCATE TABLE "capital_designations" RESTART IDENTITY',
    );
    await redisService.del(await weekKey());

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
    const redisCurrent = await redisService.get(await weekKey());
    expect(redisCurrent).toBe(dbRow[0].sigunguCode);
    expect(redisCurrent).toBe(capitalSigungucode);
  });

  describe('주 경계', () => {
    // 이번 주 원장을 비우고 "지난주 지정만 있는" 상태를 만든다.
    const seedLastWeekOnly = async (sigunguCode: string) => {
      await dataSource.query(
        'TRUNCATE TABLE "capital_designations" RESTART IDENTITY',
      );
      await redisService.del(await weekKey());
      await dataSource.query(
        'INSERT INTO capital_designations ("sigunguCode", "weekStart") VALUES ($1, $2)',
        [sigunguCode, startOfKstWeek(new Date(Date.now() - WEEK_MS))],
      );
    };

    it('이번 주 지정이 없으면 지난주 수도를 끌어쓰지 않는다 (미지정으로 응답)', async () => {
      // 조회가 "가장 최근 지정"을 쓰면 지난주 수도가 무기한 유효해진다 — 크론이 한 주를
      // 놓쳤을 때 엉뚱한 구에 1.2배 버프가 계속 붙는 상태. 주 단위로 판정해야 한다.
      await seedLastWeekOnly(capitalSigungucode);

      const res = await request(app.getHttpServer())
        .get('/api/districts/capital/current')
        .expect(200);

      const body = res.body as CapitalBody;
      expect(body.sigunguCode).toBeNull();
      expect(body.multiplier).toBe(1);
      expect(body.district).toBeNull();

      // 점수 배수도 함께 1.0이어야 한다 (지난주 수도에 버프가 남지 않는다).
      await expect(
        districtsService.getCapitalMultiplier(capitalSigungucode),
      ).resolves.toBe(1);
    });

    it('직전 주 수도는 후보에서 제외된다', async () => {
      // 후보를 2개(16, 15)로 만들고 직전 주를 16으로 두면, 제외가 동작하는 한 결과는 15뿐이다.
      const altSpot = await spotRepo.save({
        contentId: 'alt-cap-spot',
        title: '대체 후보 관광지',
        mapX: SPOT_LNG,
        mapY: SPOT_LAT,
        sigungucode: altSigungucode,
      });
      try {
        await seedLastWeekOnly(capitalSigungucode);

        const designated = await districtsService.designateWeeklyCapital();
        expect(designated?.sigunguCode).toBe(altSigungucode);
      } finally {
        await spotRepo.delete(altSpot.id);
      }
    });

    it('직전 주 수도 외 후보가 없으면 연속 지정을 허용한다', async () => {
      // 제외 규칙 때문에 수도가 아예 없어지면 안 된다 — 후보가 하나뿐이면 연속을 허용한다.
      await seedLastWeekOnly(capitalSigungucode);

      const designated = await districtsService.designateWeeklyCapital();
      expect(designated?.sigunguCode).toBe(capitalSigungucode);
    });

    it('이번 주 수도가 없으면 "없음"도 캐싱한다 (미지정 구간 반복 조회 비용 제거)', async () => {
      await seedLastWeekOnly(capitalSigungucode);

      await expect(districtsService.getCurrentCapital()).resolves.toBeNull();
      // 미지정을 캐싱하지 않으면 이후 모든 점령이 Redis 미스 + DB findOne을 한 번씩 더 돈다.
      await expect(redisService.get(await weekKey())).resolves.not.toBeNull();

      // 캐시가 실제로 쓰이는지 — 원장에 직접 행을 넣어도 TTL 동안은 "없음"으로 응답한다.
      // 지정 경로(writeCapitalCache)는 평범한 SET이라 sentinel을 즉시 덮으므로, 이 창은
      // 지정을 수행하지 않은 다른 인스턴스에만 짧게 보인다.
      await dataSource.query(
        'INSERT INTO capital_designations ("sigunguCode", "weekStart") VALUES ($1, $2)',
        [capitalSigungucode, startOfKstWeek(new Date())],
      );
      await expect(districtsService.getCurrentCapital()).resolves.toBeNull();

      // 캐시를 비우면 곧바로 원장 값을 읽는다 (sentinel이 영구 고착되지 않는다).
      await redisService.del(await weekKey());
      await expect(districtsService.getCurrentCapital()).resolves.toBe(
        capitalSigungucode,
      );
    });

    it('"없음" 캐싱이 지정자가 먼저 써둔 수도를 덮지 않는다 (SET NX)', async () => {
      // 크론이 도는 월요일 00:05 근처의 경합: 조회자가 원장 findOne을 지정자의 INSERT 커밋
      // 직전에 실행하면 null을 받는다. 그 사이 지정자는 이미 캐시에 실제 수도를 써뒀는데,
      // 조회자가 sentinel을 평범한 SET으로 덮으면 클러스터 전체가 TTL 동안 "수도 없음"으로
      // 응답한다(수도 구 점령이 1.2배 대신 1.0배). NX로 써야 이 창이 닫힌다.
      await seedLastWeekOnly(capitalSigungucode);
      const key = await weekKey();
      // 지정자가 먼저 캐시에 써둔 상태를 만든다 (원장 커밋은 아직 보이지 않는 시점).
      await redisService.set(key, capitalSigungucode, 60);
      // 조회자는 그 직전의 미스를 본 상태로 진행한다.
      const getSpy = jest
        .spyOn(redisService, 'get')
        .mockResolvedValueOnce(null);
      try {
        await expect(districtsService.getCurrentCapital()).resolves.toBeNull();
        // 핵심 단언 — 지정자의 값이 그대로 살아 있어야 한다.
        await expect(redisService.get(key)).resolves.toBe(capitalSigungucode);
      } finally {
        getSpy.mockRestore();
        await redisService.del(key);
      }
    });
  });

  it('수도 캐시 키는 원장(DB)별로 스코프된다 — 한 Redis를 공유해도 환경 간 오염이 없다', async () => {
    // 리뷰에서 실제로 재현된 케이스: 다른 DB를 보는 앱이 같은 Redis에 붙으면 같은 주의 캐시
    // 키가 겹쳐, 자기 원장엔 없는 수도가 그대로 읽힌다(유령 수도). 키에 원장 식별자를 새겨 막는다.
    const [{ db }] = await dataSource.query<{ db: string }[]>(
      'SELECT current_database() AS db',
    );
    await expect(weekKey()).resolves.toContain(`capital:${db}:`);
  });
});
