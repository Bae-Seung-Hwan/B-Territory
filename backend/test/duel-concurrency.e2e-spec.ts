import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { FirebaseService } from '../src/common/firebase/firebase.service';
import { User } from '../src/users/entities/user.entity';
import { Duel, DuelStatus } from '../src/duels/entities/duel.entity';
import { ScoreEvent } from '../src/scores/entities/score-event.entity';
import { DuelsService } from '../src/duels/duels.service';
import { RedisService } from '../src/common/redis/redis.service';
import { ErrorCode } from '../src/common/errors/error-code';
import { DUEL_REQUEST_TTL } from '../src/duels/constants';

/**
 * 결투 응답·신청 경합의 **실측** 스펙.
 *
 * duels.service.spec.ts가 이미 101건을 덮고 있지만 그쪽은 전부 mock이다 — Repository도
 * Redis도 가짜라, 조건부 UPDATE가 "정말로 한 건만 통과시키는지"는 검증되지 않는다.
 * 그건 Postgres가 같은 행에 대한 동시 UPDATE를 직렬화하고 재평가하는 동작에 기대는
 * 성질이라, 진짜 DB에 동시에 때려봐야만 나온다.
 *
 * 그래서 이 스펙은 두 가지를 한다.
 *  1. 실제 Postgres/Redis에 N개의 응답을 **동시에** 던져 정확히 하나만 이기는지 센다.
 *  2. 같은 부하를 CAS 조건만 걷어낸 대조군에 던져, 그 방어가 없으면 실제로 깨지는지 센다.
 *
 * 2번이 없으면 1번은 "원래 안 깨지는 걸 안 깨진다고 확인한" 테스트와 구별되지 않는다.
 * 집계 결과는 docs/concurrency-report.json으로 떨어뜨려 README가 인용한다.
 */

const mockFirebaseService = {
  verifyIdToken: (token: string) => Promise.resolve({ uid: token }),
};

// 부산시청 근방 — 두 유저를 같은 좌표에 두어 100m 근접 조건을 통과시킨다.
const LAT = 35.1796;
const LNG = 129.0756;

/** 한 라운드에서 같은 결투에 동시에 던지는 응답 수. */
const RESPONDERS = 8;
/** 응답 경합 라운드 수. 경합은 확률적이라 한 번으로는 아무것도 증명하지 못한다. */
const ROUNDS = 30;
/** 같은 requestId로 동시에 던지는 신청 재시도 수. */
const RETRIES = 10;

interface RoundOutcome {
  /** 예외 없이 전이에 성공한 응답 수. 정상이라면 언제나 1이다. */
  winners: number;
  /** DUEL_ALREADY_HANDLED(409)로 밀린 응답 수. */
  conflicts: number;
  /** 그 외 예외 — 하나라도 있으면 방어가 아니라 사고다. */
  unexpected: string[];
  /** 라운드 종료 시점의 revision. 전이가 한 번만 일어났다면 1이다. */
  revision: number;
  /** 이 결투에 붙은 점수 원장 건수. 두 건 이상이면 이중 차감이다. */
  scoreEvents: number;
  finalStatus: DuelStatus;
}

interface Tally {
  rounds: number;
  /** winners !== 1 인 라운드 수 — 중복 전이 또는 전이 실종. */
  brokenRounds: number;
  /** scoreEvents > 1 인 라운드 수 — 이중 차감. */
  doubleCharges: number;
  maxWinners: number;
  /**
   * 전이는 일어났는데 revision을 못 올린 횟수의 합 (winners - revision).
   *
   * 중복 전이보다 조용하고 더 고약한 결함이다. 앱 메모리에서 `revision + 1`을 계산하면
   * 동시에 읽은 N개가 전부 같은 번호를 써서, 8번 바뀐 결투의 revision이 1에 머문다.
   * 클라이언트는 이 번호로 이벤트 순서를 가리므로(duel.entity.ts의 revision 주석),
   * 번호가 안 올라가면 늦게 온 옛 상태가 새 상태를 덮어도 구분할 방법이 없다.
   * SQL `"revision" + 1`로 올려야 하는 이유가 이 수치다.
   */
  lostRevisionBumps: number;
  /** 라운드가 어떤 상태로 끝났는지 분포 — 대조군은 실행마다 갈린다(비결정성). */
  finalStatuses: Record<string, number>;
}

function tally(outcomes: RoundOutcome[]): Tally {
  return {
    rounds: outcomes.length,
    brokenRounds: outcomes.filter((o) => o.winners !== 1).length,
    doubleCharges: outcomes.filter((o) => o.scoreEvents > 1).length,
    maxWinners: Math.max(...outcomes.map((o) => o.winners)),
    lostRevisionBumps: outcomes.reduce(
      (sum, o) => sum + (o.winners - o.revision),
      0,
    ),
    finalStatuses: outcomes.reduce<Record<string, number>>((acc, o) => {
      acc[o.finalStatus] = (acc[o.finalStatus] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

function errorCodeOf(err: unknown): string {
  const body = (err as { response?: { code?: string } })?.response;
  return body?.code ?? (err as Error)?.message ?? String(err);
}

describe('결투 동시성 (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let duelsService: DuelsService;
  let redisService: RedisService;
  let userRepo: Repository<User>;
  let duelRepo: Repository<Duel>;
  let scoreRepo: Repository<ScoreEvent>;

  let challenger: User;
  let opponent: User;

  /** README가 인용할 집계. describe 전체에서 채우고 afterAll에서 파일로 쓴다. */
  const report: Record<string, unknown> = {};

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FirebaseService)
      .useValue(mockFirebaseService)
      .compile();

    app = configureApp(moduleFixture.createNestApplication());
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    duelsService = moduleFixture.get(DuelsService);
    redisService = moduleFixture.get(RedisService);
    userRepo = moduleFixture.get(getRepositoryToken(User));
    duelRepo = moduleFixture.get(getRepositoryToken(Duel));
    scoreRepo = moduleFixture.get(getRepositoryToken(ScoreEvent));

    await dataSource.query(
      'TRUNCATE TABLE "score_events", "duels", "users" RESTART IDENTITY CASCADE',
    );

    [challenger, opponent] = await userRepo.save([
      {
        firebaseUid: 'uid-duel-challenger',
        email: 'challenger@test.com',
        nickname: 'Challenger',
        nationality: 'KR',
        team: 'KR',
      },
      {
        firebaseUid: 'uid-duel-opponent',
        email: 'opponent@test.com',
        nickname: 'Opponent',
        nationality: 'JP',
        team: 'JP',
      },
    ]);
  });

  afterAll(async () => {
    const path = resolve(__dirname, '../docs/concurrency-report.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          config: { RESPONDERS, ROUNDS, RETRIES },
          ...report,
        },
        null,
        2,
      ) + '\n',
    );
    await app.close();
  });

  /**
   * 응답 경합만 떼어 보기 위해 PENDING 결투를 직접 만든다. requestDuel을 타면 근접·보호막·
   * 페널티 같은 사전 검문이 함께 걸려, 무엇이 경합을 막았는지 흐려진다.
   */
  const seedPendingDuel = async (): Promise<Duel> =>
    duelRepo.save(
      duelRepo.create({
        challengerId: challenger.id,
        opponentId: opponent.id,
        status: DuelStatus.PENDING,
        requestId: randomUUID(),
        // 무응답 만료가 실제로 점수를 물리려면 초대가 전달된 것으로 기록돼 있어야 한다
        // (buildNoResponseCharges). 이중 차감이 일어날 수 있는 조건을 만들어 둔다.
        inviteDeliveredAt: new Date(),
      }),
    );

  /** 경합에서 밀린 응답이 받아야 할 코드. enum이 아니라 string으로 비교한다. */
  const HANDLED: string = ErrorCode.DUEL_ALREADY_HANDLED;

  const observeRound = async (
    duelId: number,
    settled: PromiseSettledResult<unknown>[],
  ): Promise<RoundOutcome> => {
    const after = await duelRepo.findOneOrFail({ where: { id: duelId } });
    const reasons = settled.flatMap((r) =>
      r.status === 'rejected' ? [errorCodeOf(r.reason)] : [],
    );
    return {
      winners: settled.filter((r) => r.status === 'fulfilled').length,
      conflicts: reasons.filter((c) => c === HANDLED).length,
      unexpected: reasons.filter((c) => c !== HANDLED),
      revision: after.revision,
      scoreEvents: await scoreRepo.countBy({ duelId }),
      finalStatus: after.status,
    };
  };

  describe('같은 결투에 대한 동시 응답', () => {
    /**
     * 수락·거절·만료를 한꺼번에 던진다. 셋 다 PENDING에서 출발하는 전이라 서로 경쟁하고,
     * 하나만 이겨야 한다 — 둘이 통과하면 결투가 "수락됐는데 거절당한" 상태가 되고
     * 점수도 두 번 깎인다.
     */
    it(`수락·거절·만료를 ${RESPONDERS}개 동시에 던져도 정확히 하나만 이긴다 (${ROUNDS}라운드)`, async () => {
      const outcomes: RoundOutcome[] = [];

      for (let round = 0; round < ROUNDS; round++) {
        const duel = await seedPendingDuel();

        // 같은 tick에 한꺼번에 출발시킨다. await로 하나씩 보내면 경합 자체가 생기지 않는다.
        const settled = await Promise.allSettled(
          Array.from({ length: RESPONDERS }, (_, i) => {
            if (i % 3 === 2) {
              // expireDuel은 PENDING이 아니면 예외 대신 null을 준다 — 그대로 두면
              // "밀렸는데 성공"으로 집계되므로 여기서 거절로 바꿔 승자 기준을 통일한다.
              return duelsService.expireDuel(duel.id).then((r) => {
                if (r === null) {
                  throw Object.assign(new Error('expire lost'), {
                    response: { code: ErrorCode.DUEL_ALREADY_HANDLED },
                  });
                }
                return r;
              });
            }
            return duelsService.respondDuel(
              duel.id,
              opponent.id,
              i % 3 === 0, // 수락과 거절을 섞는다
            );
          }),
        );

        outcomes.push(await observeRound(duel.id, settled));
      }

      const result = tally(outcomes);
      report.responseRace = { guarded: result };

      // 예상 밖 예외가 하나라도 있으면 방어가 아니라 버그다.
      expect(outcomes.flatMap((o) => o.unexpected)).toEqual([]);
      expect(result.brokenRounds).toBe(0);
      expect(result.maxWinners).toBe(1);
      expect(result.doubleCharges).toBe(0);
      // 이긴 전이는 반드시 revision을 하나 올린다.
      expect(result.lostRevisionBumps).toBe(0);
      // 진 쪽은 전부 409로 돌아와야 한다 (승자 1 + 나머지 전부 conflict).
      for (const o of outcomes) {
        expect(o.conflicts).toBe(RESPONDERS - 1);
        expect(o.scoreEvents).toBeLessThanOrEqual(1);
      }
    }, 120_000);

    /**
     * 대조군. 실제 respondDuel에서 WHERE의 `status = PENDING` 조건만 걷어낸 형태로,
     * "읽어서 확인하고 → 쓴다"는 가장 흔한 구현이다. 같은 부하에서 이게 깨지는 걸
     * 보여야 위 테스트가 무엇을 지키고 있는지 증명된다.
     */
    it(`CAS 조건을 걷어내면 같은 부하에서 중복 전이가 발생한다 (대조군)`, async () => {
      const naiveRespond = async (duelId: number, accept: boolean) => {
        const duel = await duelRepo.findOneOrFail({ where: { id: duelId } });
        // 애플리케이션 레벨 확인 — 동시 요청은 전부 여기서 PENDING을 본다.
        if (duel.status !== DuelStatus.PENDING) {
          throw Object.assign(new Error('already handled'), {
            response: { code: ErrorCode.DUEL_ALREADY_HANDLED },
          });
        }
        // 실제 경로도 이 지점에 await가 있다(거절 시 usersService.findById 등).
        // 확인과 쓰기 사이의 창을 그대로 재현한다.
        await new Promise((r) => setImmediate(r));
        await duelRepo.update(
          { id: duelId }, // ← 조건이 id뿐이다. 이 한 줄이 방어의 전부였다.
          {
            status: accept ? DuelStatus.ACCEPTED : DuelStatus.REJECTED,
            revision: duel.revision + 1,
          },
        );
      };

      const outcomes: RoundOutcome[] = [];
      for (let round = 0; round < ROUNDS; round++) {
        const duel = await seedPendingDuel();
        const settled = await Promise.allSettled(
          Array.from({ length: RESPONDERS }, (_, i) =>
            naiveRespond(duel.id, i % 2 === 0),
          ),
        );
        outcomes.push(await observeRound(duel.id, settled));
      }

      const result = tally(outcomes);
      // 대조군은 전이만 하고 점수 차감 경로를 타지 않는다 — doubleCharges가 0인 것은
      // 방어가 아니라 애초에 세지 않은 것이라, 오해를 부르지 않도록 빼고 싣는다.
      report.responseRace = {
        ...(report.responseRace as object),
        naive: {
          rounds: result.rounds,
          brokenRounds: result.brokenRounds,
          maxWinners: result.maxWinners,
          lostRevisionBumps: result.lostRevisionBumps,
          finalStatuses: result.finalStatuses,
        },
      };

      // 대조군이 깨지지 않았다면 부하가 경합을 만들지 못한 것이고,
      // 그렇다면 위 테스트도 아무것도 증명하지 못한 것이다 — 같이 실패시킨다.
      expect(result.brokenRounds).toBeGreaterThan(0);
      expect(result.maxWinners).toBeGreaterThan(1);
      // 중복 전이와 함께 revision도 잃는다 — 앱에서 +1 하면 동시에 읽은 쪽이 같은 번호를 쓴다.
      expect(result.lostRevisionBumps).toBeGreaterThan(0);
    }, 120_000);
  });

  describe('응답 기한', () => {
    /**
     * 기한은 status와 **같은 UPDATE 문** 안에서 DB 시계로 본다. 앱에서 먼저 재보고
     * 나중에 쓰면, 그 사이에 기한이 지난 수락이 통과한다(서버 재시작으로 만료 타이머가
     * 유실된 경우가 실제 경로다).
     */
    it('기한이 지난 수락·거절은 행이 아직 PENDING이어도 거부된다', async () => {
      for (const accept of [true, false]) {
        const duel = await seedPendingDuel();
        // 만료 타이머를 태우지 않고 기한만 넘긴다 — 상태는 PENDING 그대로다.
        await duelRepo.query(
          `UPDATE duels SET "requestedAt" = LOCALTIMESTAMP - make_interval(secs => $1) WHERE id = $2`,
          [DUEL_REQUEST_TTL + 5, duel.id],
        );

        await expect(
          duelsService.respondDuel(duel.id, opponent.id, accept),
        ).rejects.toMatchObject({
          response: { code: ErrorCode.DUEL_ALREADY_HANDLED },
        });

        const after = await duelRepo.findOneOrFail({ where: { id: duel.id } });
        expect(after.status).toBe(DuelStatus.PENDING); // 전이는 만료 경로가 내린다
        expect(after.revision).toBe(0);
        expect(await scoreRepo.countBy({ duelId: duel.id })).toBe(0);
      }
    }, 30_000);

    it('기한 안의 수락은 통과한다 (기한 조건이 정상 경로를 막지 않는다)', async () => {
      const duel = await seedPendingDuel();
      const accepted = await duelsService.respondDuel(
        duel.id,
        opponent.id,
        true,
      );
      expect(accepted.status).toBe(DuelStatus.ACCEPTED);
      expect(accepted.revision).toBe(1);
    }, 30_000);
  });

  describe('신청 경합', () => {
    /** 신청 경로는 보호막·페널티·페어 락을 보므로 라운드마다 Redis 흔적을 걷어낸다. */
    const resetForRequest = async () => {
      await Promise.all([
        redisService.purgeUserKeys(challenger.id),
        redisService.purgeUserKeys(opponent.id),
      ]);
      await dataSource.query('TRUNCATE TABLE "duels" RESTART IDENTITY CASCADE');
      // 근접·접속 조건 복구 (purge가 geo와 meta도 지운다).
      await Promise.all([
        redisService.geoAdd(challenger.id, LAT, LNG, challenger.team, 'sock-c'),
        redisService.geoAdd(opponent.id, LAT, LNG, opponent.team, 'sock-o'),
      ]);
    };

    /**
     * ack 유실로 클라이언트가 같은 requestId를 여러 번 던지는 상황. 멱등성이 깨지면
     * 결투가 여러 개 생기고, 클라이언트는 자기가 어느 것을 기다리는지 모른다.
     */
    it(`같은 requestId로 ${RETRIES}번 동시에 신청해도 결투는 하나만 생긴다`, async () => {
      await resetForRequest();
      const requestId = randomUUID();

      const settled = await Promise.allSettled(
        Array.from({ length: RETRIES }, () =>
          duelsService.requestDuel(
            { id: challenger.id, team: challenger.team },
            opponent.id,
            requestId,
          ),
        ),
      );

      const fulfilled = settled.flatMap((r) =>
        r.status === 'fulfilled' ? [r.value] : [],
      );
      const rows = await duelRepo.countBy({ requestId });
      const duelIds = new Set(fulfilled.map((r) => r.duel.id));

      report.requestIdempotency = {
        attempts: RETRIES,
        fulfilled: fulfilled.length,
        rowsCreated: rows,
        distinctDuelIds: duelIds.size,
        createdFlagTrue: fulfilled.filter((r) => r.created).length,
        errors: settled.flatMap((r) =>
          r.status === 'rejected' ? [errorCodeOf(r.reason)] : [],
        ),
      };

      expect(rows).toBe(1);
      expect(duelIds.size).toBe(1);
      // 재시도는 전부 같은 결투를 돌려받아야 한다 — 하나라도 실패하면 살아 있는 결투를
      // 실패로 오인하는 클라이언트가 생긴다.
      expect(fulfilled.length).toBe(RETRIES);
      // 실제로 만든 것은 한 번뿐이고 나머지는 재시도로 판정돼야 한다.
      expect(fulfilled.filter((r) => r.created).length).toBe(1);
    }, 60_000);

    /**
     * A→B와 B→A가 동시에 출발하는 경우. 페어 락은 같은 쌍만 막고 유니크 인덱스는
     * challenger 기준이라, 엇갈린 방향은 참가자별 advisory lock이 유일한 방어다.
     */
    it('서로 마주 신청해도 활성 결투는 하나만 남는다', async () => {
      await resetForRequest();

      const settled = await Promise.allSettled([
        duelsService.requestDuel(
          { id: challenger.id, team: challenger.team },
          opponent.id,
          randomUUID(),
        ),
        duelsService.requestDuel(
          { id: opponent.id, team: opponent.team },
          challenger.id,
          randomUUID(),
        ),
      ]);

      const created = await duelRepo.countBy({ status: DuelStatus.PENDING });
      report.crossRequest = {
        fulfilled: settled.filter((r) => r.status === 'fulfilled').length,
        pendingRows: created,
        errors: settled.flatMap((r) =>
          r.status === 'rejected' ? [errorCodeOf(r.reason)] : [],
        ),
      };

      expect(created).toBe(1);
      expect(settled.filter((r) => r.status === 'fulfilled').length).toBe(1);
    }, 60_000);
  });
});
