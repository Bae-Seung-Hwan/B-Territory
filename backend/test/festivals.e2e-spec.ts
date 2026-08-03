import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from '../src/app-setup';
import { FirebaseService } from '../src/common/firebase/firebase.service';
import { Festival } from '../src/festivals/entities/festival.entity';
import { kstDateString } from '../src/common/utils/kst.util';

const mockFirebaseService = {
  verifyIdToken: (token: string) => Promise.resolve({ uid: token }),
};

/** KST 오늘로부터 offsetDays 만큼 이동한 'YYYY-MM-DD' */
function dayFromToday(offsetDays: number): string {
  const base = new Date(kstDateString() + 'T00:00:00Z');
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

interface FestivalBody {
  items: { contentId: string; title: string }[];
  count: number;
}

describe('Festivals (e2e)', () => {
  let app: INestApplication<App>;
  let festivalRepo: Repository<Festival>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FirebaseService)
      .useValue(mockFirebaseService)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    festivalRepo = moduleFixture.get<Repository<Festival>>(
      getRepositoryToken(Festival),
    );

    await festivalRepo.clear();
    await festivalRepo.insert([
      {
        contentId: 'ongoing-1',
        title: '진행 중 축제',
        eventStartDate: dayFromToday(-2),
        eventEndDate: dayFromToday(2),
      },
      {
        contentId: 'upcoming-1',
        title: '예정 축제',
        eventStartDate: dayFromToday(5),
        eventEndDate: dayFromToday(10),
      },
      {
        contentId: 'ended-1',
        title: '종료된 축제',
        eventStartDate: dayFromToday(-10),
        eventEndDate: dayFromToday(-5),
      },
    ]);
  });

  afterAll(async () => {
    await festivalRepo.clear();
    await app.close();
  });

  it('status 생략 시 종료되지 않은 축제(진행 중 + 예정)만 반환한다', async () => {
    const res = await request(app.getHttpServer()).get('/api/festivals');
    expect(res.status).toBe(200);
    const body = res.body as FestivalBody;
    expect(body.count).toBe(2);
    const ids = body.items.map((f) => f.contentId);
    expect(ids).toEqual(['ongoing-1', 'upcoming-1']); // 시작일 오름차순
    expect(ids).not.toContain('ended-1');
  });

  it('status=ongoing 은 진행 중 축제만 반환한다', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/festivals?status=ongoing',
    );
    expect(res.status).toBe(200);
    const body = res.body as FestivalBody;
    expect(body.count).toBe(1);
    expect(body.items[0].contentId).toBe('ongoing-1');
  });

  it('status=upcoming 은 예정 축제만 반환한다', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/festivals?status=upcoming',
    );
    expect(res.status).toBe(200);
    const body = res.body as FestivalBody;
    expect(body.count).toBe(1);
    expect(body.items[0].contentId).toBe('upcoming-1');
  });

  it('허용되지 않은 status 값은 400을 반환한다', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/festivals?status=bogus',
    );
    expect(res.status).toBe(400);
  });
});
