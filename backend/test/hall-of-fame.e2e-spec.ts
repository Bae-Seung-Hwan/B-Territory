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
import { RedisService } from '../src/common/redis/redis.service';

const mockFirebaseService = {
  verifyIdToken: (token: string) => Promise.resolve({ uid: token }),
};

// 시즌 1 = [2026-09-01, 2026-12-01) KST. 이 윈도우 안(2026-10-15)과 밖(pre-season)에 이벤트를 심어
// 시즌 필터가 절대 시각 기준으로 정확한지 검증한다 (실제 시계와 무관하게 결정적).
const IN_SEASON1 = '2026-10-15T00:00:00Z';
const PRE_SEASON = '2026-08-15T00:00:00Z';

interface RankingBody {
  season: number;
  status: string;
  start: string;
  end: string;
  ranking: { rank: number; score: number; team?: string; nickname?: string }[];
}

interface ErrorBody {
  message: string | string[];
}

describe('HallOfFame (e2e)', () => {
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let redisService: RedisService;
  let dataSource: DataSource;
  let aliceId: string;
  let bobId: string;
  let carolId: string;

  const truncateAll = () =>
    dataSource.query(
      'TRUNCATE TABLE "score_events", "users" RESTART IDENTITY CASCADE',
    );

  const insertEvent = (
    userId: string,
    team: string,
    type: string,
    personalPoints: number,
    teamPoints: number,
    createdAt: string,
  ) =>
    dataSource.query(
      `INSERT INTO score_events
         ("userId","team","type","personalPoints","teamPoints","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, team, type, personalPoints, teamPoints, createdAt],
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
    redisService = moduleFixture.get(RedisService);
    dataSource = moduleFixture.get(DataSource);

    await truncateAll();
    // 직전 실행이 남긴 캐시가 있으면 첫 조회가 stale를 반환하므로 선제 정리(실행 순서 독립).
    await redisService.deleteByPattern('hof:*');

    const [alice, bob, carol] = await userRepo.save([
      {
        firebaseUid: 'uid-alice',
        email: 'alice@test.com',
        nickname: 'Alice',
        nationality: 'KR',
        team: 'A',
      },
      {
        firebaseUid: 'uid-bob',
        email: 'bob@test.com',
        nickname: 'Bob',
        nationality: 'KR',
        team: 'B',
      },
      {
        firebaseUid: 'uid-carol',
        email: 'carol@test.com',
        nickname: 'Carol',
        nationality: 'KR',
        team: 'A',
      },
    ]);
    aliceId = alice.id;
    bobId = bob.id;
    carolId = carol.id;

    // 시즌 1 안: 팀 A(teamPoints 100+30=130) > 팀 B(100).
    // 개인 Alice(personal 100+100+50=250) > Bob(100). (개인 점수는 재방문도 100)
    await insertEvent(aliceId, 'A', 'CLAIM_NEW', 100, 100, IN_SEASON1);
    await insertEvent(aliceId, 'A', 'CLAIM_REVISIT', 100, 30, IN_SEASON1);
    await insertEvent(aliceId, 'A', 'DUEL_WIN', 50, 0, IN_SEASON1);
    await insertEvent(bobId, 'B', 'CLAIM_NEW', 100, 100, IN_SEASON1);
    // Carol은 결투 패배(개인 -30)만 → 순 0점 이하라 개인 랭킹에서 제외되어야 한다.
    await insertEvent(carolId, 'A', 'DUEL_LOSS', -30, 0, IN_SEASON1);
    // 시즌 밖(pre-season): 큰 점수라도 시즌 1 집계엔 포함되면 안 된다.
    await insertEvent(aliceId, 'A', 'CLAIM_NEW', 99999, 99999, PRE_SEASON);
  });

  afterAll(async () => {
    await truncateAll();
    await redisService.deleteByPattern('hof:*');
    await app.close();
  });

  it('팀 랭킹(season=1): teamPoints 합산 상위, 시즌 밖 이벤트 제외', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/hall-of-fame/teams?season=1')
      .expect(200);

    const body = res.body as RankingBody;
    expect(body.season).toBe(1);
    expect(body.start).toBe('2026-08-31T15:00:00.000Z');
    expect(body.end).toBe('2026-11-30T15:00:00.000Z');
    // pre-season의 99999가 새면 A가 10만점대가 됨 → 130이면 시즌 필터 정상
    expect(body.ranking).toEqual([
      { rank: 1, team: 'A', score: 130 },
      { rank: 2, team: 'B', score: 100 },
    ]);
  });

  it('개인 랭킹(season=1): personalPoints 합산 상위, 순 0점 이하(Carol) 제외', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/hall-of-fame/users?season=1')
      .expect(200);

    const body = res.body as RankingBody;
    expect(body.ranking.map((r) => r.nickname)).toEqual(['Alice', 'Bob']);
    expect(body.ranking[0]).toMatchObject({
      rank: 1,
      nickname: 'Alice',
      team: 'A',
      score: 250,
    });
    expect(body.ranking[1]).toMatchObject({
      rank: 2,
      nickname: 'Bob',
      score: 100,
    });
    expect(body.ranking.some((r) => r.nickname === 'Carol')).toBe(false);
  });

  it('조회 결과가 Redis에 캐시된다 (hof:teams:1)', async () => {
    await request(app.getHttpServer())
      .get('/api/hall-of-fame/teams?season=1')
      .expect(200);

    const cached = await redisService.get('hof:teams:1');
    expect(cached).not.toBeNull();
    const parsed = JSON.parse(cached as string) as RankingBody;
    expect(parsed.ranking[0]).toMatchObject({ team: 'A', score: 130 });
  });

  it('Redis 도달 불가여도 DB로 랭킹을 계산해 200을 반환한다', async () => {
    // 캐시는 순수한 가속 장치다 — Redis 장애가 랭킹 API 전체를 500으로 만들면 안 된다.
    // 감싸지 않으면 redis.get()이 null 대신 MaxRetriesPerRequestError를 던져 그대로 올라간다.
    const err = new Error(
      'Reached the max retries per request limit (which is 3).',
    );
    const getSpy = jest.spyOn(redisService, 'get').mockRejectedValue(err);
    const setSpy = jest.spyOn(redisService, 'set').mockRejectedValue(err);
    try {
      const res = await request(app.getHttpServer())
        .get('/api/hall-of-fame/teams?season=1')
        .expect(200);

      const body = res.body as RankingBody;
      expect(body.ranking[0]).toMatchObject({ team: 'A', score: 130 });
      expect(getSpy).toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
      setSpy.mockRestore();
    }
  });

  it('캐시에 깨진 값이 있으면 미스로 취급하고 DB로 폴백한다', async () => {
    await redisService.set('hof:teams:1', '{not json', 60);

    const res = await request(app.getHttpServer())
      .get('/api/hall-of-fame/teams?season=1')
      .expect(200);

    const body = res.body as RankingBody;
    expect(body.ranking[0]).toMatchObject({ team: 'A', score: 130 });
  });

  it('이벤트 없는 시즌은 빈 랭킹을 반환한다', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/hall-of-fame/teams?season=99')
      .expect(200);

    const body = res.body as RankingBody;
    expect(body.season).toBe(99);
    expect(body.ranking).toEqual([]);
  });

  it('season 파라미터 없으면 현재 시즌으로 200 (기본값)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/hall-of-fame/teams')
      .expect(200);

    const body = res.body as RankingBody;
    expect(body.season).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.ranking)).toBe(true);
  });

  it('잘못된 season(0, 문자, 상한 초과)은 400', async () => {
    await request(app.getHttpServer())
      .get('/api/hall-of-fame/teams?season=0')
      .expect(400);

    // 상한 초과 — Invalid Date로 500이 나지 않고 검증 단계에서 400으로 막혀야 한다.
    await request(app.getHttpServer())
      .get('/api/hall-of-fame/teams?season=2000000000')
      .expect(400);

    const res = await request(app.getHttpServer())
      .get('/api/hall-of-fame/teams?season=abc')
      .expect(400);
    expect((res.body as ErrorBody).message).toBeDefined();
  });
});
