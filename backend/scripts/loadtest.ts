/**
 * 부하 테스트 — 실제 유저가 없는 서비스의 용량을 숫자로 남기기 위한 스크립트.
 *
 *   docker compose up -d   # Postgres + Redis
 *   npm run loadtest
 *
 * 앱을 별도로 띄우지 않고 이 프로세스 안에서 부팅한다(e2e와 같은 방식). 덕분에
 *   - 아무 환경에서나 한 줄로 재현되고,
 *   - 측정 대상이 "지금 이 커밋의 코드"임이 보장되며,
 *   - 시드 데이터를 알고 있으므로 요청이 성공 경로를 탔는지 서버 쪽에서 되짚을 수 있다.
 *
 * 마지막 항목이 중요하다. 점령 API는 일일 제한·방어 타이머·근접 검사로 막히면 409를 내는데,
 * 그 경로는 DB 쓰기가 거의 없어 훨씬 빠르다. 그걸 모르고 재면 "초당 N건 처리"가 사실은
 * "초당 N건 거절"이 된다. 그래서 시드를 (유저 × 관광지) 조합이 전부 처음인 상태로 깔고,
 * 끝난 뒤 원장에 쌓인 건수를 세어 성공 경로였음을 리포트에 함께 남긴다.
 *
 * 결과는 docs/loadtest-report.json.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import autocannon, { Result } from 'autocannon';
import { AddressInfo } from 'net';
import type { Server } from 'http';
import globalSetup from '../test/global-e2e-setup';
// 타입만 정적으로 가져온다(컴파일 시 지워져 런타임 import가 일어나지 않는다).
// 값은 globalSetup이 process.env를 고친 **뒤에** 동적으로 불러와야 한다.
import type { DataSource as DataSourceType, Repository } from 'typeorm';
import type { User as UserEntity } from '../src/users/entities/user.entity';
import type { Spot as SpotEntity } from '../src/spots/entities/spot.entity';
import type { ScoreEvent as ScoreEventEntity } from '../src/scores/entities/score-event.entity';

config({ path: resolve(__dirname, '../.env') });

/** 동시 접속 수. 공모전 시연 규모(수십 명)의 몇 배를 상정한 값이다. */
const CONNECTIONS = 50;
/** 읽기 시나리오 측정 시간(초). */
const DURATION = 10;
/** 본 측정 전에 버리는 예열 시간(초) — 커넥션 풀·JIT가 데워지기 전 수치는 의미가 없다. */
const WARMUP = 3;

/**
 * 점령 쓰기 시나리오용 시드 규모.
 *
 * 점령은 (유저, 관광지)마다 하루 한 번만 성공한다. autocannon은 요청 틀을 한 번 만들어
 * 재사용해 요청마다 헤더를 갈아끼우기 어려우므로, 유저는 하나로 두고 **관광지를 요청 수만큼**
 * 깔아 모든 요청이 서로 다른 조합이 되게 한다. 한 유저로도 방어 타이머에는 막히지 않는다
 * (같은 팀 재방문은 통과).
 */
const SEED_SPOTS = 3000;
/** 쓰기 시나리오는 시간이 아니라 건수로 잰다 — 조합이 소진되면 409 경로로 넘어가기 때문. */
const WRITE_REQUESTS = SEED_SPOTS;

// 부산시청 근방. 시드 관광지를 이 점 주변에 흩뿌리되, 요청은 관광지 좌표를 그대로 보내
// 50m 근접 조건을 항상 통과시킨다(거리 판정이 아니라 처리량을 재는 시나리오다).
const BASE_LAT = 35.1796;
const BASE_LNG = 129.0756;

interface ScenarioReport {
  name: string;
  description: string;
  method: string;
  path: string;
  connections: number;
  /** 초당 처리 건수 (평균). */
  rps: number;
  latencyMs: { p50: number; p90: number; p99: number; max: number };
  requests: number;
  non2xx: number;
  errors: number;
  /** 2xx가 아닌 응답이 섞였다면 그 비율 — 0이 아니면 위 수치는 성공 경로의 값이 아니다. */
  errorRate: number;
}

function summarize(
  name: string,
  description: string,
  method: string,
  path: string,
  r: Result,
): ScenarioReport {
  const non2xx = r.non2xx ?? 0;
  const errors = r.errors ?? 0;
  const total = r.requests.total;
  return {
    name,
    description,
    method,
    path,
    connections: r.connections,
    rps: Number(r.requests.average.toFixed(1)),
    latencyMs: {
      p50: r.latency.p50,
      p90: r.latency.p90,
      p99: r.latency.p99,
      max: r.latency.max,
    },
    requests: total,
    non2xx,
    errors,
    errorRate: total === 0 ? 1 : Number(((non2xx + errors) / total).toFixed(4)),
  };
}

async function main(): Promise<void> {
  // 개발 DB가 아니라 e2e와 같은 <DB_NAME>_test / Redis 15번을 쓰도록 맞춘다.
  // 이 스크립트는 TRUNCATE로 시작하므로 개발 데이터에 붙으면 안 된다.
  await globalSetup();

  // NODE_ENV=development면 TypeORM이 모든 쿼리를 stdout에 찍는다. 수만 건을 때리는
  // 동안의 동기 콘솔 출력은 그 자체로 측정값을 망가뜨리므로 반드시 꺼야 한다.
  process.env.NODE_ENV = 'test';

  // globalSetup이 process.env를 바꾼 뒤에 앱을 읽어야 한다 — 정적 import면 그 전에 평가된다.
  const { Test } = await import('@nestjs/testing');
  const { getRepositoryToken } = await import('@nestjs/typeorm');
  const { DataSource } = await import('typeorm');
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/app-setup');
  const { FirebaseService } =
    await import('../src/common/firebase/firebase.service');
  const { User } = await import('../src/users/entities/user.entity');
  const { Spot } = await import('../src/spots/entities/spot.entity');
  const { ScoreEvent } =
    await import('../src/scores/entities/score-event.entity');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FirebaseService)
    // 토큰 문자열을 그대로 uid로 본다 — 부하 테스트에서 재려는 것은 Firebase 왕복이 아니라
    // 우리 서버의 처리량이다. 외부 호출이 섞이면 측정값이 남의 지연시간이 된다.
    .useValue({
      verifyIdToken: (token: string) => Promise.resolve({ uid: token }),
    })
    .compile();

  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  await app.listen(0);

  const dataSource = moduleRef.get<DataSourceType>(DataSource);
  const userRepo = moduleRef.get<Repository<UserEntity>>(
    getRepositoryToken(User),
  );
  const spotRepo = moduleRef.get<Repository<SpotEntity>>(
    getRepositoryToken(Spot),
  );
  const scoreRepo = moduleRef.get<Repository<ScoreEventEntity>>(
    getRepositoryToken(ScoreEvent),
  );

  // listen(0)으로 빈 포트를 받았으므로 실제 포트는 서버에 물어본다.
  const server = app.getHttpServer() as Server;
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  const base = `${origin}/api`;

  // ---- 시드 ----------------------------------------------------------------
  await dataSource.query(
    'TRUNCATE TABLE "score_events", "district_claim_history", "spot_claims", "district_claims", "duels", "users", "spots" RESTART IDENTITY CASCADE',
  );

  const uid = 'load-uid-0';
  await userRepo.save({
    firebaseUid: uid,
    email: `${uid}@loadtest.local`,
    nickname: 'Load 0',
    nationality: 'KR',
    team: 'KR',
  });

  // +1은 예비 요청 몫이다. 예비 요청도 조합 하나를 소진하므로 본 측정과 겹치면
  // 첫 요청이 일일 제한에 걸린다.
  const spots = await spotRepo.save(
    Array.from({ length: SEED_SPOTS + 1 }, (_, i) => ({
      contentId: `load-${i}`,
      title: `부하 테스트 관광지 ${i}`,
      // 관광지끼리는 떨어뜨리되(서로 다른 지점), 요청은 각자의 좌표를 그대로 보낸다.
      // mapX가 경도, mapY가 위도다 (관광공사 API 명명을 그대로 따른 컬럼).
      mapX: BASE_LNG + Math.floor(i / 30) * 0.002,
      mapY: BASE_LAT + (i % 30) * 0.002,
      areacode: '6',
      sigungucode: '16',
      contenttypeid: '12',
    })),
  );
  const spotCoords = spots.map((s) => ({
    id: s.id,
    lat: Number(s.mapY),
    lng: Number(s.mapX),
  }));

  // ---- 시나리오 ------------------------------------------------------------
  const run = (opts: autocannon.Options): Promise<Result> =>
    autocannon({ ...opts, excludeErrorStats: false });

  /** 같은 설정으로 짧게 한 번 돌려 버린다 (예열). */
  const warmup = async (opts: autocannon.Options) => {
    await run({
      ...opts,
      duration: WARMUP,
      amount: undefined,
      connections: 10,
    });
  };

  const scenarios: ScenarioReport[] = [];

  // 쓰기를 **먼저** 돌린다. 읽기 시나리오(특히 랭킹 집계)를 빈 원장에서 재면 스캔할 행이
  // 없어 비현실적으로 빠른 숫자가 나온다 — 조회 성능은 데이터가 쌓인 상태의 값이라야 뜻이 있다.
  // 쓰기가 남긴 점령·원장 위에서 읽기를 재도록 순서를 고정한다.

  // 본 측정 전에 한 건만 직접 쏴본다. 점령 API는 막히면 409/400을 내는데 그 경로도
  // 응답은 빠르므로, 확인 없이 재면 "초당 N건 거절"을 처리량으로 착각하게 된다.
  // 여기서 본문째 드러내고 멈추는 편이 잘못된 숫자를 리포트에 남기는 것보다 낫다.
  const preflightSpot = spotCoords[SEED_SPOTS]; // 본 측정이 쓰지 않는 여분의 관광지
  const preflightRes = await fetch(`${base}/claims/visit`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${uid}`,
    },
    body: JSON.stringify({
      spotId: preflightSpot.id,
      lat: preflightSpot.lat,
      lng: preflightSpot.lng,
    }),
  });
  if (!preflightRes.ok) {
    throw new Error(
      `점령 예비 요청 실패 (${preflightRes.status}): ${await preflightRes.text()}\n` +
        '시드 조건이나 인증이 어긋났다는 뜻이다. 이대로 재면 거절 경로의 처리량이 나온다.',
    );
  }

  /** i번째 요청이 쓸 관광지. 요청마다 다른 관광지라 전부 그날의 첫 점령이 된다. */
  const visitBody = (i: number) => {
    const spot = spotCoords[i % SEED_SPOTS];
    return JSON.stringify({ spotId: spot.id, lat: spot.lat, lng: spot.lng });
  };

  let seq = 0;
  process.stdout.write(`▶ claim-visit 측정 ${WRITE_REQUESTS}건…\n`);
  const visitResult = await run({
    // requests[].path는 url의 경로를 이어붙이지 않고 대체한다 — 여기서는 /api까지 직접 쓴다.
    url: origin,
    connections: CONNECTIONS,
    amount: WRITE_REQUESTS,
    // setupRequest는 **requests 배열 안에** 있어야 요청마다 다시 불린다.
    // 최상위 옵션으로 주면 요청 틀을 만들 때 한 번만 적용되고(requestIterator는
    // currentRequest.setupRequest만 본다), 이후 모든 요청이 첫 본문을 그대로 재전송한다
    // — 같은 관광지를 3000번 점령하려 들어 2999건이 일일 제한 409로 떨어진다.
    requests: [
      {
        method: 'POST',
        path: '/api/claims/visit',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${uid}`,
        },
        body: visitBody(0),
        setupRequest: (req) => ({ ...req, body: visitBody(seq++) }),
      },
    ],
  });
  scenarios.push(
    summarize(
      'claim-visit',
      'GPS 방문 인증 + 점령 (PostGIS 거리 판정 · Redis 일일/방어 게이트 · 점수 원장 기록)',
      'POST',
      '/claims/visit',
      visitResult,
    ),
  );

  // 쓰기가 실제로 반영됐는지 서버 쪽에서 되짚는다. 이 값이 요청 수와 크게 다르면
  // 위 처리량은 성공 경로의 값이 아니다.
  const ledgerRows = await scoreRepo.count();

  // 리포트에 남기기 전에 여기서 막는다. 거절 경로는 DB 쓰기가 거의 없어 훨씬 빠르므로,
  // 실패가 섞인 수치를 "처리량"으로 실으면 실제보다 좋아 보이는 숫자가 박제된다.
  const visitReport = scenarios[scenarios.length - 1];
  if (visitReport.errorRate > 0.01 || ledgerRows - 1 !== WRITE_REQUESTS) {
    throw new Error(
      `점령 쓰기 측정이 성공 경로를 타지 않았다 — ` +
        `실패율 ${visitReport.errorRate}, 원장 ${ledgerRows - 1}/${WRITE_REQUESTS}행. ` +
        '시드 조합이 소진됐거나 요청이 제대로 전달되지 않은 것이다.',
    );
  }

  // ---- 읽기 시나리오 (쓰기가 남긴 데이터 위에서) ----------------------------
  const readScenarios: { name: string; description: string; path: string }[] = [
    {
      name: 'spots-list',
      description: `관광지 목록 (페이지네이션 + 구 필터, 관광지 ${SEED_SPOTS + 1}건)`,
      path: '/spots?limit=20&sigungucode=16',
    },
    {
      name: 'spot-claim-status',
      description: '관광지 점령 현황 (관광지 × 점령 조인, 점령된 관광지)',
      path: `/claims/spots/${spotCoords[0].id}`,
    },
    {
      name: 'hall-of-fame',
      description: `명예의 전당 유저 랭킹 (점수 원장 ${ledgerRows}행 집계)`,
      path: '/hall-of-fame/users',
    },
  ];

  for (const s of readScenarios) {
    const opts: autocannon.Options = {
      url: `${base}${s.path}`,
      connections: CONNECTIONS,
      duration: DURATION,
    };
    process.stdout.write(`▶ ${s.name} 예열…\n`);
    await warmup(opts);
    process.stdout.write(`▶ ${s.name} 측정 ${DURATION}s…\n`);
    scenarios.push(
      summarize(s.name, s.description, 'GET', s.path, await run(opts)),
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    env: {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      cpus: (await import('os')).cpus().length,
      note: '단일 로컬 머신에서 앱·Postgres·Redis·부하 생성기가 모두 함께 돌았다. 분리된 환경의 수치가 아니라 상대 비교용이다.',
    },
    config: { CONNECTIONS, DURATION, WARMUP, SEED_SPOTS, WRITE_REQUESTS },
    // 읽기 시나리오는 쓰기 시나리오가 만들어 둔 상태 위에서 측정했다.
    datasetAtReadTime: { spots: SEED_SPOTS + 1, scoreEvents: ledgerRows },
    scenarios,
    writeVerification: {
      requestsSent: WRITE_REQUESTS,
      // 예비 요청 1건이 먼저 원장에 들어가 있다.
      scoreEventsPersisted: ledgerRows - 1,
      note: '점령 성공마다 원장 1행. 요청 수와 같아야 성공 경로를 측정한 것이다.',
    },
  };

  const out = resolve(__dirname, '../docs/loadtest-report.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');

  console.table(
    scenarios.map((s) => ({
      시나리오: s.name,
      RPS: s.rps,
      'p50(ms)': s.latencyMs.p50,
      'p99(ms)': s.latencyMs.p99,
      요청: s.requests,
      실패율: s.errorRate,
    })),
  );
  console.log(
    `\n점령 쓰기 검증: 요청 ${WRITE_REQUESTS}건 → 원장 ${ledgerRows - 1}행`,
  );
  console.log(`리포트: ${out}`);

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
