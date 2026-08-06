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
// 업로드 인자를 기록해, 확장자·Content-Type이 클라이언트 선언값이 아니라
// 매직 바이트로 판별한 실제 포맷에서 파생되는지 검증한다.
let lastUpload: { contentType: string; ext: string } | null = null;
const mockS3Service = {
  upload: (
    _buffer: Buffer,
    contentType: string,
    _prefix: string,
    ext: string,
  ) => {
    lastUpload = { contentType, ext };
    return Promise.resolve(MOCK_IMAGE_URL);
  },
};
// 매직 바이트 검증(JPEG: FF D8 FF)을 통과하는 최소 버퍼
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(20),
]);
// 매직 바이트 검증(PNG: 89 50 4E 47 0D 0A 1A 0A)을 통과하는 최소 버퍼
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(20),
]);
// 인터셉터의 5MB 상한을 넘기는 버퍼 (앞부분은 유효한 JPEG 시그니처)
const OVERSIZED_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(6 * 1024 * 1024),
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
      {
        firebaseUid: 'uid-C',
        email: 'c@test.com',
        nickname: '유저C',
        nationality: 'KR',
        team: 'A',
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

  describe('사진 업로드 방어', () => {
    // 다른 describe에 의존하지 않도록 이 describe 전용 유저(uid-C)로 방문 창을 연다.
    beforeAll(async () => {
      await checkin('uid-C');
      lastUpload = null;
    });

    it('5MB 초과 업로드는 413 — 인터셉터가 스트림 단계에서 끊는다', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/missions/photo')
        .set('Authorization', 'Bearer uid-C')
        .field('spotId', String(spotId))
        .attach('image', OVERSIZED_BYTES, {
          filename: 'huge.jpg',
          contentType: 'image/jpeg',
        });
      expect(res.status).toBe(413);
      // 거부된 업로드는 S3까지 가지 않는다 (일일 게이트도 소진되지 않음).
      expect(lastUpload).toBeNull();
    });

    it('파일이 아닌 대량 필드도 거부된다 — fileSize만으로는 안 막히는 경로', async () => {
      const req = request(app.getHttpServer())
        .post('/api/missions/photo')
        .set('Authorization', 'Bearer uid-C');
      // 512KB × 40개 = 20MB. fields/parts 상한이 없으면 전부 메모리에 버퍼링된다.
      const chunk = 'a'.repeat(512 * 1024);
      for (let i = 0; i < 40; i++) req.field(`junk${i}`, chunk);
      const res = await req;
      expect(res.status).toBe(400);
      // 상한이 없으면 20MB를 다 버퍼링한 뒤 ValidationPipe가 400을 내므로,
      // 상한이 실제로 동작했는지는 "multer 한도" 메시지로만 구분된다.
      expect(String((res.body as { message?: string }).message)).toMatch(
        /too long|too many/i,
      );
      expect(lastUpload).toBeNull();
    });

    it('파일명·mimetype을 위조해도 저장 확장자·Content-Type은 실제 바이트를 따른다', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/missions/photo')
        .set('Authorization', 'Bearer uid-C')
        .field('spotId', String(spotId))
        // 실제 바이트는 PNG인데 클라이언트는 .html + image/jpeg로 선언
        .attach('image', PNG_BYTES, {
          filename: 'evil.html',
          contentType: 'image/jpeg',
        });
      expect(res.status).toBe(201);
      expect(lastUpload).toEqual({ contentType: 'image/png', ext: '.png' });
    });
  });
});
