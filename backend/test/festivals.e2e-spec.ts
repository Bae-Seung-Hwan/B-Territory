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
import { FestivalsService } from '../src/festivals/festivals.service';
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
  let festivalsService: FestivalsService;

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
    festivalsService = moduleFixture.get(FestivalsService);

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

  describe('동기화 upsert', () => {
    // private 메서드지만 동기화의 핵심 데이터 규칙이라 직접 고정한다.
    // (syncFromApi 전체는 외부 API 호출이라 e2e에서 돌릴 수 없다)
    const upsert = (rows: unknown[]) =>
      (
        festivalsService as unknown as {
          upsertBatch(rows: unknown[]): Promise<void>;
        }
      ).upsertBatch(rows);

    const row = (over: Record<string, unknown>) => ({
      contentId: 'sync-x',
      title: '동기화 축제',
      addr1: null,
      mapX: null,
      mapY: null,
      firstimage: null,
      tel: null,
      eventStartDate: dayFromToday(1),
      eventEndDate: dayFromToday(3),
      areacode: '6',
      sigungucode: null,
      updatedAt: new Date(),
      ...over,
    });

    const find = (contentId: string) =>
      festivalRepo.findOneOrFail({ where: { contentId } });

    afterEach(async () => {
      await festivalRepo.delete({ areacode: '6' });
    });

    it('좌표가 있는 행과 없는 행이 섞인 배치에서 기존 좌표가 지워지지 않는다', async () => {
      // 회귀 방지: repository.upsert()는 ON CONFLICT SET 절을 배치 전체의 합집합으로 만들어,
      // 좌표를 주지 않은 행이 DEFAULT(NULL)로 들어가며 저장된 좌표를 덮어썼다.
      await upsert([
        row({ contentId: 'sync-a', mapX: 129.1, mapY: 35.1 }),
        row({ contentId: 'sync-b', mapX: 129.2, mapY: 35.2 }),
      ]);

      // 재동기화: a는 좌표를 주고, b는 API가 좌표를 누락한 상황
      await upsert([
        row({ contentId: 'sync-a', title: '갱신', mapX: 129.9, mapY: 35.9 }),
        row({ contentId: 'sync-b', title: '갱신', mapX: null, mapY: null }),
      ]);

      const a = await find('sync-a');
      const b = await find('sync-b');
      expect(a.mapX).toBeCloseTo(129.9); // 준 값은 갱신
      expect(b.mapX).toBeCloseTo(129.2); // 안 준 값은 기존 유지
      expect(b.mapY).toBeCloseTo(35.2);
      expect(b.title).toBe('갱신'); // 준 필드는 정상 갱신
    });

    it('빈 문자열은 null로 정규화되어 기존 값을 덮지 않는다', async () => {
      // TourAPI는 값 없는 필드를 ''로 주는 일이 잦은데, ''는 null이 아니라 COALESCE를
      // 통과해 멀쩡한 값을 ''로 덮는다. 서비스가 nullIfBlank로 걸러야 한다.
      await upsert([
        row({ contentId: 'sync-c', addr1: '부산시 중구', tel: '051-1' }),
      ]);
      await upsert([row({ contentId: 'sync-c', addr1: null, tel: null })]);

      const c = await find('sync-c');
      expect(c.addr1).toBe('부산시 중구');
      expect(c.tel).toBe('051-1');
    });

    it('신규 축제는 그대로 삽입된다', async () => {
      await upsert([row({ contentId: 'sync-d', mapX: 129.5, mapY: 35.5 })]);

      const d = await find('sync-d');
      expect(d.mapX).toBeCloseTo(129.5);
      expect(d.addr1).toBeNull();
    });
  });
});
