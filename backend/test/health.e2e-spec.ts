import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from '../src/app-setup';
import { FirebaseService } from '../src/common/firebase/firebase.service';
import { RedisService } from '../src/common/redis/redis.service';

const mockFirebaseService = {
  verifyIdToken: (token: string) => Promise.resolve({ uid: token }),
};

interface HealthBody {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  redis: 'up' | 'down';
}

/**
 * 배포 게이트(docker-compose healthcheck + `up --wait`)가 이 엔드포인트의 상태코드로
 * 배포 성공/실패를 판정하므로, 의존성별 등급이 뒤바뀌지 않는지 고정한다.
 */
describe('Health (e2e)', () => {
  let app: INestApplication<App>;
  let redisService: RedisService;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FirebaseService)
      .useValue(mockFirebaseService)
      .compile();

    app = configureApp(moduleFixture.createNestApplication());
    await app.init();

    redisService = moduleFixture.get(RedisService);
    dataSource = moduleFixture.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('의존성이 모두 정상이면 200 ok', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    expect(res.body as HealthBody).toEqual({
      status: 'ok',
      db: 'up',
      redis: 'up',
    });
  });

  it('Redis 불가는 degraded 200 — 배포를 실패시키지 않는다', async () => {
    // 앱은 Redis 장애를 캐시 미스로 흡수하도록 설계돼 있다. 여기서 503을 내면 그 설계와
    // 모순되고, 배포 중 일시적인 Redis 순단이 멀쩡한 배포를 실패시킨다.
    const spy = jest
      .spyOn(redisService, 'ping')
      .mockRejectedValue(new Error('redis unreachable'));
    try {
      const res = await request(app.getHttpServer())
        .get('/api/health')
        .expect(200);

      expect(res.body as HealthBody).toEqual({
        status: 'degraded',
        db: 'up',
        redis: 'down',
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('DB 불가는 503 — 배포 게이트를 통과하지 못한다', async () => {
    // 루트(/api)는 정적 문자열이라 DB가 죽어도 200이 나온다. 이 엔드포인트는 그 상태를
    // 실패로 드러내야 "떴지만 아무것도 못 하는" 인스턴스가 배포를 통과하지 않는다.
    const spy = jest
      .spyOn(dataSource, 'query')
      .mockRejectedValue(new Error('db unreachable'));
    try {
      const res = await request(app.getHttpServer())
        .get('/api/health')
        .expect(503);

      expect(res.body as HealthBody).toEqual({
        status: 'degraded',
        db: 'down',
        redis: 'up',
      });
    } finally {
      spy.mockRestore();
    }
  });
});
