import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { FirebaseService } from '../src/common/firebase/firebase.service';
import { User } from '../src/users/entities/user.entity';
import { Spot } from '../src/spots/entities/spot.entity';
import { SpotClaim } from '../src/claims/entities/spot-claim.entity';
import { DistrictClaim } from '../src/claims/entities/district-claim.entity';
import { ClaimsService } from '../src/claims/claims.service';

const mockFirebaseService = {
  verifyIdToken: (token: string) => Promise.resolve({ uid: token }),
};

// Busan City Hall 근방 좌표
const SPOT_LAT = 35.1796;
const SPOT_LNG = 129.0756;

describe('Claims (e2e)', () => {
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let spotRepo: Repository<Spot>;
  let spotClaimRepo: Repository<SpotClaim>;
  let districtClaimRepo: Repository<DistrictClaim>;
  let claimsService: ClaimsService;
  let dataSource: DataSource;
  let spotId: number;
  const sigungucode = '99TEST';

  const truncateAll = () =>
    dataSource.query(
      'TRUNCATE TABLE "spot_claims", "district_claims", "users", "spots" RESTART IDENTITY CASCADE',
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FirebaseService)
      .useValue(mockFirebaseService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    userRepo = moduleFixture.get(getRepositoryToken(User));
    spotRepo = moduleFixture.get(getRepositoryToken(Spot));
    spotClaimRepo = moduleFixture.get(getRepositoryToken(SpotClaim));
    districtClaimRepo = moduleFixture.get(getRepositoryToken(DistrictClaim));
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
  });

  afterAll(async () => {
    await truncateAll();
    await app.close();
  });

  it('시나리오 1: 반경 50m 이내 좌표 → 201 점령 성공', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/claims/visit')
      .set('Authorization', 'Bearer uid-teamA')
      .send({ spotId, lat: SPOT_LAT, lng: SPOT_LNG })
      .expect(201);

    expect(res.body).toMatchObject({ success: true, spotId, team: 'A' });
    expect(res.body.defenseSeconds).toBeGreaterThan(0);
  });

  it('시나리오 2: 50m 초과 좌표 → 400 방문 인증 실패', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/claims/visit')
      .set('Authorization', 'Bearer uid-teamA')
      .send({ spotId, lat: SPOT_LAT + 0.01, lng: SPOT_LNG })
      .expect(400);

    expect(res.body.message).toContain('방문 인증 실패');
  });

  it('시나리오 3: 5분 내 다른 팀 방문 → 409 방어 시간 중 + 남은 초 반환', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/claims/visit')
      .set('Authorization', 'Bearer uid-teamB')
      .send({ spotId, lat: SPOT_LAT, lng: SPOT_LNG })
      .expect(409);

    expect(res.body.message).toContain('방어 시간 중');
    expect(res.body.message).toMatch(/\d+초/);
  });

  it('시나리오 4: GET /claims/spots/:spotId — 점령 현황 정상 반환', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/claims/spots/${spotId}`)
      .expect(200);

    expect(res.body).toMatchObject({ spotId, team: 'A' });
    expect(res.body.claimedAt).not.toBeNull();
  });

  it('시나리오 5: GET /claims/districts/:sigungucode — 구 단위 현황 정상 반환', async () => {
    await claimsService.aggregateDistricts();

    const res = await request(app.getHttpServer())
      .get(`/api/claims/districts/${sigungucode}`)
      .expect(200);

    expect(res.body).toMatchObject({
      sigungucode,
      team: 'A',
      spotCount: 1,
    });
    expect(res.body.calculatedAt).not.toBeNull();
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

    expect(res.body.message).toContain('팀이 배정되지 않은');
  });
});
