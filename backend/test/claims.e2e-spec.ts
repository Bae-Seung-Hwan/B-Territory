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
import { ClaimsService } from '../src/claims/claims.service';
import {
  ScoreEvent,
  ScoreEventType,
} from '../src/scores/entities/score-event.entity';
import { DistrictClaimHistory } from '../src/claims/entities/district-claim-history.entity';

const mockFirebaseService = {
  verifyIdToken: (token: string) => Promise.resolve({ uid: token }),
};

// Busan City Hall 근방 좌표
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

interface ErrorBody {
  message: string;
}

interface SpotClaimBody {
  spotId: number;
  team: string | null;
  claimedAt: string | null;
}

interface DistrictClaimBody {
  sigungucode: string;
  team: string | null;
  teamScore: number;
  calculatedAt: string | null;
}

describe('Claims (e2e)', () => {
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let spotRepo: Repository<Spot>;
  let scoreRepo: Repository<ScoreEvent>;
  let historyRepo: Repository<DistrictClaimHistory>;
  let claimsService: ClaimsService;
  let dataSource: DataSource;
  let spotId: number;
  let weightedSpotId: number;
  const sigungucode = '99TEST';
  // 실제 시딩된 구 코드(해운대구=16, 외국인 방문 비율이 높아 가중치 > 1) — 가중치 반영 검증용
  const weightedSigungucode = '16';

  // districts는 부팅 시 CSV로 시딩된 레퍼런스 데이터라 truncate 대상에서 제외한다
  // (가중치 캐시는 부팅 시 메모리에 로드되므로 점수 산정에 영향 없음).
  const truncateAll = () =>
    dataSource.query(
      'TRUNCATE TABLE "score_events", "district_claim_history", "spot_claims", "district_claims", "users", "spots" RESTART IDENTITY CASCADE',
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
    scoreRepo = moduleFixture.get(getRepositoryToken(ScoreEvent));
    historyRepo = moduleFixture.get(getRepositoryToken(DistrictClaimHistory));
    claimsService = moduleFixture.get(ClaimsService);
    dataSource = moduleFixture.get(DataSource);

    await truncateAll();

    await userRepo.save([
      {
        firebaseUid: 'uid-teamA',
        email: 'teamA@test.com',
        nickname: 'TeamA User',
        nationality: 'KR',
        team: 'A',
      },
      {
        firebaseUid: 'uid-teamB',
        email: 'teamB@test.com',
        nickname: 'TeamB User',
        nationality: 'KR',
        team: 'B',
      },
      {
        firebaseUid: 'uid-noteam',
        email: 'noteam@test.com',
        nickname: 'NoTeam User',
        nationality: 'KR',
        team: '',
      },
    ]);

    const spot = await spotRepo.save({
      contentId: 'test-spot-1',
      title: '테스트 관광지',
      mapX: SPOT_LNG,
      mapY: SPOT_LAT,
      sigungucode,
    });
    spotId = spot.id;

    // 가중치 검증용 — 실제 시딩된 구(해운대구=16)에 속한 관광지
    const weightedSpot = await spotRepo.save({
      contentId: 'test-spot-weighted',
      title: '가중치 테스트 관광지',
      mapX: SPOT_LNG,
      mapY: SPOT_LAT,
      sigungucode: weightedSigungucode,
    });
    weightedSpotId = weightedSpot.id;
  });

  afterAll(async () => {
    await truncateAll();
    await app.close();
  });

  it('시나리오 1: 반경 50m 이내 좌표 → 201 점령 성공 + 신규 점수 지급', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/claims/visit')
      .set('Authorization', 'Bearer uid-teamA')
      .send({ spotId, lat: SPOT_LAT, lng: SPOT_LNG })
      .expect(201);

    const body = res.body as VisitSuccessBody;
    // 99TEST는 districts 미등록 → 가중치 1.0 → 기본 점수 그대로
    expect(body).toMatchObject({
      success: true,
      spotId,
      team: 'A',
      type: ScoreEventType.CLAIM_NEW,
      pointsAwarded: 100,
      teamPointsAwarded: 100,
    });
    expect(body.defenseSeconds).toBeGreaterThan(0);

    // 원장에 NEW 이벤트 1건 적재
    const events = await scoreRepo.find({ where: { spotId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: ScoreEventType.CLAIM_NEW,
      team: 'A',
      personalPoints: 100,
      teamPoints: 100,
    });

    // user.score 반영
    const user = await userRepo.findOne({
      where: { firebaseUid: 'uid-teamA' },
    });
    expect(user?.score).toBe(100);
  });

  it('시나리오 1-B: 같은 날 같은 관광지 재방문 → 방문 성공하되 점수 0 (일일 제한)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/claims/visit')
      .set('Authorization', 'Bearer uid-teamA')
      .send({ spotId, lat: SPOT_LAT, lng: SPOT_LNG })
      .expect(201);

    const body = res.body as VisitSuccessBody;
    expect(body).toMatchObject({
      success: true,
      team: 'A',
      type: ScoreEventType.CLAIM_REVISIT,
      pointsAwarded: 0,
      teamPointsAwarded: 0,
    });

    // 점수 0이므로 원장·user.score 모두 증가하지 않음
    const events = await scoreRepo.find({ where: { spotId } });
    expect(events).toHaveLength(1);
    const user = await userRepo.findOne({
      where: { firebaseUid: 'uid-teamA' },
    });
    expect(user?.score).toBe(100);
  });

  it('시나리오 1-C: 외국인 방문 비율 가중치가 점수에 반영된다', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/claims/visit')
      .set('Authorization', 'Bearer uid-teamA')
      .send({ spotId: weightedSpotId, lat: SPOT_LAT, lng: SPOT_LNG })
      .expect(201);

    const body = res.body as VisitSuccessBody;
    expect(body.type).toBe(ScoreEventType.CLAIM_NEW);
    // 해운대구(16)는 가중치 > 1 → 기본 100보다 큰 점수
    expect(body.pointsAwarded).toBeGreaterThan(100);
    expect(body.teamPointsAwarded).toBe(body.pointsAwarded);
  });

  it('시나리오 2: 50m 초과 좌표 → 400 방문 인증 실패', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/claims/visit')
      .set('Authorization', 'Bearer uid-teamA')
      .send({ spotId, lat: SPOT_LAT + 0.01, lng: SPOT_LNG })
      .expect(400);

    expect((res.body as ErrorBody).message).toContain('방문 인증 실패');
  });

  it('시나리오 3: 5분 내 다른 팀 방문 → 409 방어 시간 중 + 남은 초 반환', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/claims/visit')
      .set('Authorization', 'Bearer uid-teamB')
      .send({ spotId, lat: SPOT_LAT, lng: SPOT_LNG })
      .expect(409);

    const body = res.body as ErrorBody;
    expect(body.message).toContain('방어 시간 중');
    expect(body.message).toMatch(/\d+초/);
  });

  it('시나리오 4: GET /claims/spots/:spotId — 점령 현황 정상 반환', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/claims/spots/${spotId}`)
      .expect(200);

    const body = res.body as SpotClaimBody;
    expect(body).toMatchObject({ spotId, team: 'A' });
    expect(body.claimedAt).not.toBeNull();
  });

  it('시나리오 5: 12h 윈도우 집계 → 구 보유팀·팀점수 판정 + 이력 적재', async () => {
    const result = await claimsService.aggregateDistricts();
    // 99TEST(팀점수 100) + 해운대구 16(가중치 반영) 두 구가 활동으로 갱신됨
    expect(result.aggregated).toBeGreaterThanOrEqual(2);
    expect(result.snapshot).toBeGreaterThanOrEqual(2);

    const res = await request(app.getHttpServer())
      .get(`/api/claims/districts/${sigungucode}`)
      .expect(200);

    const body = res.body as DistrictClaimBody;
    expect(body).toMatchObject({
      sigungucode,
      team: 'A',
      teamScore: 100,
    });
    expect(body.calculatedAt).not.toBeNull();

    // 이력 테이블(명예의 전당 소스)에 스냅샷 적재 확인
    const history = await historyRepo.find({ where: { sigungucode } });
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0]).toMatchObject({ team: 'A', teamScore: 100 });
  });

  it('시나리오 6: spotId에 음수 또는 문자 전송 → 400 validation 오류', async () => {
    await request(app.getHttpServer())
      .post('/api/claims/visit')
      .set('Authorization', 'Bearer uid-teamA')
      .send({ spotId: -1, lat: SPOT_LAT, lng: SPOT_LNG })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/claims/visit')
      .set('Authorization', 'Bearer uid-teamA')
      .send({ spotId: 'abc', lat: SPOT_LAT, lng: SPOT_LNG })
      .expect(400);
  });

  it('보너스: 팀 미배정 사용자 방문 시도 → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/claims/visit')
      .set('Authorization', 'Bearer uid-noteam')
      .send({ spotId, lat: SPOT_LAT, lng: SPOT_LNG })
      .expect(400);

    expect((res.body as ErrorBody).message).toContain('팀이 배정되지 않은');
  });
});
