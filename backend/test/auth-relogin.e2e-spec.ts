import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { FirebaseService } from '../src/common/firebase/firebase.service';
import { User } from '../src/users/entities/user.entity';

const FIREBASE_UID = 'e2e-relogin-uid';

// 토큰 문자열은 "uid:세션번호" 형태 — 실제 재로그인처럼 매번 다른 토큰 문자열이지만
// 같은 uid로 디코딩되는 상황을 재현
const mockFirebaseService = {
  verifyIdToken: (token: string) => {
    const [uid] = token.split(':');
    return Promise.resolve({ uid, email: `${uid}@test.com` });
  },
};

interface ErrorBody {
  message: string;
}

interface ProfileBody {
  id: string;
  nickname: string;
  nationality: string;
  team: string;
}

describe('Auth 재로그인 시 중복 가입 방지 및 프로필 조회 (e2e)', () => {
  let app: INestApplication<App>;
  let userRepo: Repository<User>;

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
    await userRepo.delete({ firebaseUid: FIREBASE_UID });
  });

  afterAll(async () => {
    await userRepo.delete({ firebaseUid: FIREBASE_UID });
    await app.close();
  });

  it('가입 전 GET /auth/me → 404', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${FIREBASE_UID}:login-session-0`)
      .expect(404);

    expect((res.body as ErrorBody).message).toContain('등록되지 않은');
  });

  it('최초 로그인(토큰 A)으로 register → 201 가입 성공', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${FIREBASE_UID}:login-session-1`)
      .send({ nickname: '홍길동', nationality: 'KR' })
      .expect(201);

    expect(res.body).toMatchObject({ nickname: '홍길동', nationality: 'KR' });
  });

  it('재로그인(토큰 B, 같은 uid)으로 register 재호출 → 409, 새 row 생성 안 됨', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${FIREBASE_UID}:login-session-2`) // 재로그인으로 발급된 다른 토큰
      .send({ nickname: '다른닉네임', nationality: 'JP' })
      .expect(409);

    expect((res.body as ErrorBody).message).toContain('이미 가입된');

    const count = await userRepo.count({
      where: { firebaseUid: FIREBASE_UID },
    });
    expect(count).toBe(1); // 계정이 중복 생성되지 않음

    const user = await userRepo.findOne({
      where: { firebaseUid: FIREBASE_UID },
    });
    expect(user?.nickname).toBe('홍길동'); // 최초 가입 값 그대로 유지
  });

  it('재로그인(토큰 C, 같은 uid)으로 GET /auth/me → 200, register 없이 기존 프로필 확인', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${FIREBASE_UID}:login-session-3`)
      .expect(200);

    const body = res.body as ProfileBody;
    expect(body).toMatchObject({ nickname: '홍길동', nationality: 'KR' });
  });
});
