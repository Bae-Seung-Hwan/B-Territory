import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from '../src/app-setup';
import { FirebaseService } from '../src/common/firebase/firebase.service';
import { S3Service } from '../src/common/s3/s3.service';
import { User } from '../src/users/entities/user.entity';
import { Spot } from '../src/spots/entities/spot.entity';

const mockFirebaseService = {
  verifyIdToken: (token: string) => Promise.resolve({ uid: token }),
};
const MOCK_IMAGE_URL = 'https://s3.test/missions/photos/mock.jpg';
const mockS3Service = {
  upload: () => Promise.resolve(MOCK_IMAGE_URL),
};
// 매직 바이트 검증(JPEG: FF D8 FF)을 통과하는 최소 버퍼
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(20),
]);

// Busan City Hall 근방 (스팟 좌표와 동일 → 50m 이내)
const SPOT_LAT = 35.1796;
const SPOT_LNG = 129.0756;
// 수 km 밖 (50m 초과)
const FAR_LAT = 35.15;
const FAR_LNG = 129.05;

interface MissionBody {
  success: boolean;
  spotId: number;
  type: string;
  pointsAwarded: number;
  teamPointsAwarded: number;
  imageUrl?: string;
}
interface ReviewListBody {
  spotId: number;
  count: number;
  averageRating: number | null;
  items: { rating: number; content: string | null; nickname: string }[];
}

describe('Missions (e2e)', () => {
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let spotRepo: Repository<Spot>;
  let dataSource: DataSource;
  let spotId: number;

  const truncateAll = () =>
    dataSource.query(
      'TRUNCATE TABLE "score_events", "reviews", "mission_photos", "spot_claims", "users", "spots" RESTART IDENTITY CASCADE',
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FirebaseService)
      .useValue(mockFirebaseService)
      .overrideProvider(S3Service)
      .useValue(mockS3Service)
      .compile();

    app = configureApp(moduleFixture.createNestApplication());
    await app.init();

    userRepo = moduleFixture.get(getRepositoryToken(User));
    spotRepo = moduleFixture.get(getRepositoryToken(Spot));
    dataSource = moduleFixture.get(DataSource);

    await truncateAll();
    await userRepo.save([
      {
        firebaseUid: 'uid-A',
        email: 'a@test.com',
        nickname: '유저A',
        nationality: 'KR',
        team: 'A',
      },
      {
        firebaseUid: 'uid-B',
        email: 'b@test.com',
        nickname: '유저B',
        nationality: 'KR',
        team: 'B',
      },
    ]);
    const spot = await spotRepo.save({
      contentId: 'mission-spot-1',
      title: '미션 테스트 관광지',
      mapX: SPOT_LNG,
      mapY: SPOT_LAT,
      sigungucode: '99TEST',
    });
    spotId = spot.id;
  });

  afterAll(async () => {
    await truncateAll();
    await app.close();
  });

  const checkin = (token: string, lat = SPOT_LAT, lng = SPOT_LNG) =>
    request(app.getHttpServer())
      .post('/api/missions/checkin')
      .set('Authorization', `Bearer ${token}`)
      .send({ spotId, lat, lng });

  describe('방문 체크인', () => {
    it('현장(50m 이내) 체크인 시 201 + 24시간 창 오픈', async () => {
      const res = await checkin('uid-A');
      expect(res.status).toBe(201);
      const body = res.body as { success: boolean; expiresInSeconds: number };
      expect(body.success).toBe(true);
      expect(body.expiresInSeconds).toBeGreaterThan(0);
    });

    it('50m 밖 체크인은 400 (방문 전제 실패)', async () => {
      const res = await checkin('uid-B', FAR_LAT, FAR_LNG);
      expect(res.status).toBe(400);
    });
  });

  describe('리뷰 미션', () => {
    // 이 describe가 다른 describe의 체크인에 의존하지 않도록 방문 창을 자체 확보한다.
    // (재체크인은 창을 새 TTL로 덮어쓰는 멱등 동작)
    beforeAll(async () => {
      await checkin('uid-A');
    });

    it('체크인 없이 리뷰 작성은 400 (방문 창 없음)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/missions/review')
        .set('Authorization', 'Bearer uid-B')
        .send({ spotId, rating: 3 });
      expect(res.status).toBe(400);
    });

    it('체크인 후 리뷰 작성 시 201 + 개인 보너스 지급', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/missions/review')
        .set('Authorization', 'Bearer uid-A')
        .send({ spotId, rating: 5, content: '좋아요' });
      expect(res.status).toBe(201);
      const body = res.body as MissionBody;
      expect(body.type).toBe('MISSION_REVIEW');
      expect(body.pointsAwarded).toBeGreaterThan(0);
      expect(body.teamPointsAwarded).toBe(0);

      const user = await userRepo.findOneByOrFail({ firebaseUid: 'uid-A' });
      expect(user.score).toBe(body.pointsAwarded);
    });

    it('같은 날 같은 관광지 리뷰 재작성은 409 (체크인 창은 유효)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/missions/review')
        .set('Authorization', 'Bearer uid-A')
        .send({ spotId, rating: 4 });
      expect(res.status).toBe(409);
    });

    it('리뷰 목록은 최신순 + 평균 별점·닉네임을 반환', async () => {
      const res = await request(app.getHttpServer()).get(
        `/api/missions/reviews?spotId=${spotId}`,
      );
      expect(res.status).toBe(200);
      const body = res.body as ReviewListBody;
      expect(body.count).toBe(1);
      expect(body.averageRating).toBe(5);
      expect(body.items[0].nickname).toBe('유저A');
      expect(body.items[0].rating).toBe(5);
    });
  });

  describe('사진 미션', () => {
    // 이 describe가 다른 describe의 체크인에 의존하지 않도록 방문 창을 자체 확보한다.
    beforeAll(async () => {
      await checkin('uid-A');
    });

    it('체크인 없이 사진 업로드는 400 (방문 창 없음)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/missions/photo')
        .set('Authorization', 'Bearer uid-B')
        .field('spotId', String(spotId))
        .attach('image', JPEG_BYTES, {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        });
      expect(res.status).toBe(400);
    });

    it('체크인 후 사진 업로드 시 201 + imageUrl + 보너스', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/missions/photo')
        .set('Authorization', 'Bearer uid-A')
        .field('spotId', String(spotId))
        .attach('image', JPEG_BYTES, {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        });
      expect(res.status).toBe(201);
      const body = res.body as MissionBody;
      expect(body.type).toBe('MISSION_PHOTO');
      expect(body.imageUrl).toBe(MOCK_IMAGE_URL);
      expect(body.pointsAwarded).toBeGreaterThan(0);
    });

    it('같은 날 사진 재인증은 409 (체크인 창은 유효)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/missions/photo')
        .set('Authorization', 'Bearer uid-A')
        .field('spotId', String(spotId))
        .attach('image', JPEG_BYTES, {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        });
      expect(res.status).toBe(409);
    });
  });
});
