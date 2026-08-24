import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { MinigameService } from './minigame.service';
import { DuelsService } from '../duels.service';
import { RedisService } from '../../common/redis/redis.service';
import { Duel, DuelStatus } from '../entities/duel.entity';
import { QUIZ_BANK } from './quiz-bank';
import {
  MiniGameType,
  QUIZ_MIN_READ_MS,
  REACTION_GO_MAX_MS,
  REACTION_GO_MIN_MS,
  TAP_DURATION_SEC,
  TAP_MAX,
} from './constants';

const CHALLENGER = 'user-a';
const OPPONENT = 'user-b';
const DUEL_ID = 1;
/** 고정 기준 시각 — 서버가 시간을 직접 재므로 테스트가 도착 시각을 통제한다. */
const T0 = 1_700_000_000_000;

interface SessionOverrides {
  startedAt?: number;
  goAt?: number;
}

describe('MinigameService', () => {
  let service: MinigameService;
  let redis: jest.Mocked<
    Pick<
      RedisService,
      | 'get'
      | 'set'
      | 'del'
      | 'submitGameScore'
      | 'claimRoundSettlement'
      | 'releaseRoundSettlement'
    >
  >;
  let duelsService: jest.Mocked<
    Pick<
      DuelsService,
      'getAcceptedDuel' | 'markResultInProgress' | 'finishByGame' | 'voidByGame'
    >
  >;

  /** 세션 키는 하나뿐이라 문자열 한 칸으로 흉내낸다 (재경기 시 라운드가 올라간 값으로 덮인다) */
  let sessionRaw: string | null;
  /** `${duelId}:${round}` -> userId -> entry. Lua HSETNX의 "먼저 쓴 값만 남는다"를 재현한다. */
  let scoreStore: Map<string, Map<string, string>>;
  /** 정산 권리를 이미 가져간 라운드 (`${duelId}:${round}`) */
  let settled: Set<string>;

  const duel = {
    id: DUEL_ID,
    challengerId: CHALLENGER,
    opponentId: OPPONENT,
    status: DuelStatus.ACCEPTED,
  } as Duel;

  const setSession = (
    type: MiniGameType,
    round = 1,
    quizAnswerIndex?: number,
    overrides: SessionOverrides = {},
  ) => {
    sessionRaw = JSON.stringify({
      type,
      round,
      quizAnswerIndex,
      // 참가자는 세션에 담긴다 — submit()이 DB를 다녀오지 않고 확인하기 위해서다.
      challengerId: CHALLENGER,
      opponentId: OPPONENT,
      // 기본값은 넉넉히 과거로 — TAP의 최소 경과시간 검사를 자연스럽게 통과한다.
      startedAt: overrides.startedAt ?? Date.now() - 60_000,
      goAt: overrides.goAt,
    });
  };

  const readSession = () =>
    JSON.parse(sessionRaw!) as {
      type: MiniGameType;
      round: number;
      startedAt: number;
      challengerId: string;
      opponentId: string;
      quizAnswerIndex?: number;
      goAt?: number;
    };

  /** 제출이 서버에 도착하는 시각을 순서대로 지정한다 (submit 한 번당 Date.now() 한 번). */
  const arriveAt = (...times: number[]) => {
    const spy = jest.spyOn(Date, 'now');
    for (const t of times) spy.mockReturnValueOnce(t);
    // 재경기 세션 생성 등 뒤따르는 호출을 위한 기본값
    spy.mockReturnValue(times[times.length - 1]);
  };

  const submit = (userId: string, value?: number, round = 1) =>
    service.submit(DUEL_ID, userId, { duelId: DUEL_ID, round, value });

  beforeEach(async () => {
    sessionRaw = null;
    scoreStore = new Map();
    settled = new Set();

    redis = {
      get: jest.fn(() => Promise.resolve(sessionRaw)),
      set: jest.fn((_key: string, value: string) => {
        sessionRaw = value;
        return Promise.resolve();
      }),
      del: jest.fn(() => {
        sessionRaw = null;
        return Promise.resolve();
      }),
      submitGameScore: jest.fn(
        (duelId: number, round: number, userId: string, entry: string) => {
          const key = `${duelId}:${round}`;
          const hash = scoreStore.get(key) ?? new Map<string, string>();
          scoreStore.set(key, hash);
          if (hash.has(userId))
            return Promise.resolve({ status: 'duplicate' as const });
          hash.set(userId, entry);
          return Promise.resolve({
            status: hash.size < 2 ? 'waiting' : 'both',
          });
        },
      ),
      // 락 획득과 점수 읽기가 한 연산이라는 점을 흉내낸다 — 선점에 성공한 호출만
      // 그 시점의 스냅샷을 받는다.
      claimRoundSettlement: jest.fn((duelId: number, round: number) => {
        const key = `${duelId}:${round}`;
        if (settled.has(key))
          return Promise.resolve({ claimed: false as const });
        settled.add(key);
        return Promise.resolve({
          claimed: true as const,
          entries: new Map(scoreStore.get(key) ?? []),
        });
      }),
      releaseRoundSettlement: jest.fn((duelId: number, round: number) => {
        settled.delete(`${duelId}:${round}`);
        return Promise.resolve();
      }),
    } as unknown as typeof redis;

    duelsService = {
      getAcceptedDuel: jest.fn().mockResolvedValue(duel),
      markResultInProgress: jest.fn().mockResolvedValue(undefined),
      finishByGame: jest.fn((_duelId: number, winnerId: string) =>
        Promise.resolve({
          status: 'confirmed' as const,
          duel: {
            ...duel,
            status: DuelStatus.COMPLETED,
            winnerId,
            loserId: winnerId === CHALLENGER ? OPPONENT : CHALLENGER,
          },
        }),
      ),
      voidByGame: jest
        .fn()
        .mockResolvedValue({ ...duel, status: DuelStatus.VOID }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MinigameService,
        { provide: RedisService, useValue: redis },
        { provide: DuelsService, useValue: duelsService },
      ],
    }).compile();

    service = module.get(MinigameService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('start', () => {
    it('세션에 서버 시계 기준 시작 시각을 남긴다', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0); // 게임 종류 -> TAP
      arriveAt(T0);

      const { payload, goDelayMs } = await service.start(duel);

      expect(payload.gameType).toBe(MiniGameType.TAP);
      expect(payload.round).toBe(1);
      expect(payload.tap?.durationSec).toBe(TAP_DURATION_SEC);
      expect(goDelayMs).toBeNull();
      expect(readSession().startedAt).toBe(T0);
    });

    it('반응속도는 출발 신호 대기 시간을 서버가 정하고 페이로드에 싣지 않는다', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5); // 게임 종류 -> REACTION
      arriveAt(T0); // deadlineAt을 고정해 아래 문자열 검사가 흔들리지 않게 한다

      const { payload, goDelayMs } = await service.start(duel);

      expect(payload.gameType).toBe(MiniGameType.REACTION);
      expect(goDelayMs).toBeGreaterThanOrEqual(REACTION_GO_MIN_MS);
      expect(goDelayMs).toBeLessThan(REACTION_GO_MAX_MS);
      // 언제 켜질지 알면 미리 눌러둘 수 있다 — 페이로드에 흔적이 없어야 한다
      expect(JSON.stringify(payload)).not.toContain(String(goDelayMs));
      expect(readSession().goAt).toBeUndefined();
    });

    it('퀴즈는 선택지를 섞어 내려보내고 정답 위치는 세션에만 남긴다', async () => {
      jest
        .spyOn(Math, 'random')
        .mockReturnValueOnce(0.9) // 게임 종류 -> QUIZ
        .mockReturnValueOnce(0) // 문제 -> QUIZ_BANK[0]
        .mockReturnValue(0); // 셔플: 항상 0번과 교환

      const { payload } = await service.start(duel);
      const question = QUIZ_BANK[0];

      expect(payload.gameType).toBe(MiniGameType.QUIZ);
      // 정답이 원래 위치(0번)에 그대로 있지 않아야 한다 — 첫 선택지만 찍는 공략을 막는 게 목적
      const answerIndex = readSession().quizAnswerIndex!;
      expect(answerIndex).not.toBe(0);
      expect(payload.quiz?.choices[answerIndex].ko).toBe(
        question.choices[question.answerIndex].ko,
      );
      expect(JSON.stringify(payload)).not.toContain('answerIndex');
    });
  });

  describe('markGo — 출발 신호', () => {
    it('발사 시각을 서버 시계로 기록한다', async () => {
      setSession(MiniGameType.REACTION);
      arriveAt(T0);

      await expect(service.markGo(DUEL_ID, 1)).resolves.toBe(true);
      expect(readSession().goAt).toBe(T0);
    });

    it('이미 쏜 신호는 다시 기록하지 않는다', async () => {
      setSession(MiniGameType.REACTION, 1, undefined, { goAt: T0 });

      await expect(service.markGo(DUEL_ID, 1)).resolves.toBe(false);
      expect(readSession().goAt).toBe(T0);
    });

    it('지난 라운드나 다른 게임의 신호는 무시한다', async () => {
      setSession(MiniGameType.REACTION, 2);
      await expect(service.markGo(DUEL_ID, 1)).resolves.toBe(false);

      setSession(MiniGameType.TAP);
      await expect(service.markGo(DUEL_ID, 1)).resolves.toBe(false);
    });
  });

  describe('submit — 검증', () => {
    it('결투 참가자가 아니면 거부한다', async () => {
      setSession(MiniGameType.TAP);

      await expect(submit('user-c', 10)).rejects.toThrow(ForbiddenException);
    });

    it('진행 중인 세션이 없으면 거부한다', async () => {
      await expect(submit(CHALLENGER, 10)).rejects.toThrow(ConflictException);
    });

    it('이미 지난 라운드의 제출은 거부한다', async () => {
      setSession(MiniGameType.TAP, 2);

      await expect(submit(CHALLENGER, 10, 1)).rejects.toThrow(
        ConflictException,
      );
    });

    it('같은 라운드에 두 번 제출하면 거부한다 (유리한 값으로 덮어쓰기 차단)', async () => {
      setSession(MiniGameType.TAP);
      await submit(CHALLENGER, 10);

      await expect(submit(CHALLENGER, 40)).rejects.toThrow(ConflictException);
    });

    it('사람이 낼 수 없는 탭 수는 거부하고 Redis에 기록하지 않는다', async () => {
      setSession(MiniGameType.TAP);

      await expect(submit(CHALLENGER, TAP_MAX + 1)).rejects.toThrow(
        BadRequestException,
      );
      expect(redis.submitGameScore).not.toHaveBeenCalled();
    });

    it('게임 시간을 채우기 전에 도착한 탭 제출은 거부한다', async () => {
      setSession(MiniGameType.TAP, 1, undefined, { startedAt: T0 });
      // 5초짜리 게임인데 0.5초 만에 도착 — 플레이하지 않고 만든 값이다
      arriveAt(T0 + 500);

      await expect(submit(CHALLENGER, 30)).rejects.toThrow(BadRequestException);
      expect(redis.submitGameScore).not.toHaveBeenCalled();
    });

    it('탭 수·선택지가 없는 제출은 거부한다', async () => {
      setSession(MiniGameType.TAP);
      await expect(submit(CHALLENGER)).rejects.toThrow(BadRequestException);

      setSession(MiniGameType.QUIZ, 1, 2);
      await expect(submit(CHALLENGER)).rejects.toThrow(BadRequestException);
    });

    it('먼저 제출한 쪽에게는 상대 점수를 알려주지 않는다', async () => {
      setSession(MiniGameType.TAP);

      const outcome = await submit(CHALLENGER, 30);

      expect(outcome.status).toBe('waiting');
      expect(JSON.stringify(outcome)).not.toContain('30');
      expect(duelsService.finishByGame).not.toHaveBeenCalled();
    });
  });

  describe('판정 — 연타', () => {
    it('탭 수가 많은 쪽이 이긴다', async () => {
      setSession(MiniGameType.TAP);

      await submit(CHALLENGER, 20);
      const outcome = await submit(OPPONENT, 35);

      expect(outcome.status).toBe('completed');
      expect(duelsService.finishByGame).toHaveBeenCalledWith(DUEL_ID, OPPONENT);
    });

    it('결과에는 상대가 실제로 낸 값이 함께 담긴다', async () => {
      setSession(MiniGameType.TAP);

      await submit(CHALLENGER, 20);
      const outcome = await submit(OPPONENT, 35);

      expect(outcome.status === 'completed' && outcome.scores).toEqual([
        { userId: CHALLENGER, submitted: true, value: 20 },
        { userId: OPPONENT, submitted: true, value: 35 },
      ]);
    });
  });

  describe('판정 — 반응속도 (서버 측정)', () => {
    it('서버가 신호를 쏜 시각부터 도착까지를 재서 빠른 쪽이 이긴다', async () => {
      setSession(MiniGameType.REACTION, 1, undefined, { goAt: T0 });
      arriveAt(T0 + 250, T0 + 400);

      await submit(CHALLENGER);
      const outcome = await submit(OPPONENT);

      expect(outcome.status).toBe('completed');
      expect(duelsService.finishByGame).toHaveBeenCalledWith(
        DUEL_ID,
        CHALLENGER,
      );
    });

    it('클라이언트가 보낸 값은 판정에 쓰이지 않는다', async () => {
      setSession(MiniGameType.REACTION, 1, undefined, { goAt: T0 });
      // 도전자는 1ms를 주장하지만 실제 도착은 늦고, 상대는 9999를 주장하지만 실제로 빠르다
      arriveAt(T0 + 400, T0 + 250);

      await submit(CHALLENGER, 1);
      const outcome = await submit(OPPONENT, 9999);

      expect(outcome.status).toBe('completed');
      expect(duelsService.finishByGame).toHaveBeenCalledWith(DUEL_ID, OPPONENT);
      // 저장된 값도 서버가 잰 실측치다
      expect(outcome.status === 'completed' && outcome.scores).toEqual([
        { userId: CHALLENGER, submitted: true, value: 400, falseStart: false },
        { userId: OPPONENT, submitted: true, value: 250, falseStart: false },
      ]);
    });

    it('신호 전에 누르면 부정출발로 최하점 처리된다', async () => {
      setSession(MiniGameType.REACTION, 1, undefined, { goAt: T0 });
      arriveAt(T0 - 100, T0 + 900);

      await submit(CHALLENGER);
      const outcome = await submit(OPPONENT);

      expect(outcome.status).toBe('completed');
      expect(duelsService.finishByGame).toHaveBeenCalledWith(DUEL_ID, OPPONENT);
      expect(
        outcome.status === 'completed' &&
          outcome.scores.find((s) => s.userId === CHALLENGER),
      ).toEqual({
        userId: CHALLENGER,
        submitted: true,
        value: null,
        falseStart: true,
      });
    });

    it('부정출발이라도 아예 안 낸 상대는 이긴다 (잠수로 패배 회피 차단)', async () => {
      setSession(MiniGameType.REACTION, 1, undefined, { goAt: T0 });
      arriveAt(T0 - 100);

      await submit(CHALLENGER); // 부정출발
      const outcome = await service.expireRound(DUEL_ID, 1); // 상대는 끝까지 미제출

      expect(outcome?.status).toBe('completed');
      expect(duelsService.finishByGame).toHaveBeenCalledWith(
        DUEL_ID,
        CHALLENGER,
      );
    });

    it('신호가 아직 안 나갔는데 온 제출도 부정출발이다 (연타로 0ms 만들기 차단)', async () => {
      setSession(MiniGameType.REACTION); // goAt 없음
      arriveAt(T0, T0);

      await submit(CHALLENGER);
      const outcome = await submit(OPPONENT);

      // 둘 다 부정출발 = 동점 -> 재경기
      expect(outcome.status).toBe('rematch');
      expect(duelsService.finishByGame).not.toHaveBeenCalled();
    });
  });

  describe('판정 — 퀴즈 (서버 채점·서버 계측)', () => {
    it('정답자가 이긴다 (느리게 답해도)', async () => {
      setSession(MiniGameType.QUIZ, 1, 2, { startedAt: T0 });
      arriveAt(T0 + 500, T0 + 9000);

      await submit(CHALLENGER, 0);
      const outcome = await submit(OPPONENT, 2);

      expect(outcome.status).toBe('completed');
      expect(duelsService.finishByGame).toHaveBeenCalledWith(DUEL_ID, OPPONENT);
    });

    it('둘 다 정답이면 서버가 잰 응답 시간이 빠른 쪽이 이긴다', async () => {
      setSession(MiniGameType.QUIZ, 1, 2, { startedAt: T0 });
      arriveAt(T0 + 5000, T0 + 2000);

      await submit(CHALLENGER, 2);
      const outcome = await submit(OPPONENT, 2);

      expect(outcome.status).toBe('completed');
      expect(duelsService.finishByGame).toHaveBeenCalledWith(DUEL_ID, OPPONENT);
    });

    it('읽을 시간도 없이 도착한 정답은 속도 이점을 얻지 못한다', async () => {
      setSession(MiniGameType.QUIZ, 1, 2, { startedAt: T0 });
      // 100ms 만에 답한 쪽과 정직하게 읽고 답한 쪽 — 둘 다 하한으로 묶여 무승부가 된다
      arriveAt(T0 + 100, T0 + QUIZ_MIN_READ_MS);

      await submit(CHALLENGER, 2);
      const outcome = await submit(OPPONENT, 2);

      expect(outcome.status).toBe('rematch');
      expect(duelsService.finishByGame).not.toHaveBeenCalled();
    });

    it('둘 다 오답이면 응답 속도로 우열을 가리지 않는다 (찍기 방지)', async () => {
      setSession(MiniGameType.QUIZ, 1, 2, { startedAt: T0 });
      arriveAt(T0 + 900, T0 + 9000);

      await submit(CHALLENGER, 0);
      const outcome = await submit(OPPONENT, 1);

      expect(outcome.status).toBe('rematch');
      expect(duelsService.finishByGame).not.toHaveBeenCalled();
    });
  });

  describe('동점 / 재경기', () => {
    it('동점이면 다음 라운드를 열고 세션을 갱신한다', async () => {
      setSession(MiniGameType.TAP);
      jest.spyOn(Math, 'random').mockReturnValue(0);

      await submit(CHALLENGER, 25);
      const outcome = await submit(OPPONENT, 25);

      expect(outcome.status).toBe('rematch');
      expect(outcome.status === 'rematch' && outcome.plan.payload.round).toBe(
        2,
      );
      expect(readSession().round).toBe(2);
      expect(duelsService.finishByGame).not.toHaveBeenCalled();
      expect(duelsService.voidByGame).not.toHaveBeenCalled();
    });

    it('재경기도 동점이면 결투를 무효 처리한다', async () => {
      setSession(MiniGameType.TAP, 2);

      await submit(CHALLENGER, 25, 2);
      const outcome = await submit(OPPONENT, 25, 2);

      expect(outcome.status).toBe('void');
      expect(duelsService.voidByGame).toHaveBeenCalledWith(DUEL_ID);
      expect(duelsService.finishByGame).not.toHaveBeenCalled();
    });
  });

  describe('expireRound — 마감', () => {
    it('제출하지 않은 쪽이 기권패한다', async () => {
      setSession(MiniGameType.TAP);
      await submit(CHALLENGER, 3);

      const outcome = await service.expireRound(DUEL_ID, 1);

      expect(outcome?.status).toBe('completed');
      expect(duelsService.finishByGame).toHaveBeenCalledWith(
        DUEL_ID,
        CHALLENGER,
      );
    });

    it('양쪽 다 미제출이면 재경기 없이 무효 처리한다', async () => {
      setSession(MiniGameType.TAP);

      const outcome = await service.expireRound(DUEL_ID, 1);

      expect(outcome?.status).toBe('void');
      expect(duelsService.voidByGame).toHaveBeenCalledWith(DUEL_ID);
      // 아무도 없는 판에 재경기를 열지 않는다 — 세션은 그대로 정리된다
      expect(sessionRaw).toBeNull();
    });

    it('결투가 이미 끝났으면 아무 일도 하지 않는다', async () => {
      setSession(MiniGameType.TAP);
      duelsService.getAcceptedDuel.mockRejectedValue(new ConflictException());

      await expect(service.expireRound(DUEL_ID, 1)).resolves.toBeNull();
      expect(duelsService.voidByGame).not.toHaveBeenCalled();
    });

    it('지난 라운드의 마감 타이머는 현재 라운드를 건드리지 않는다', async () => {
      setSession(MiniGameType.TAP, 2);

      await expect(service.expireRound(DUEL_ID, 1)).resolves.toBeNull();
      expect(duelsService.voidByGame).not.toHaveBeenCalled();
    });

    it('마감 타이머와 양쪽 제출이 겹쳐도 정산은 한 번만 일어난다', async () => {
      setSession(MiniGameType.TAP);
      await submit(CHALLENGER, 10);
      // 다른 쪽이 이미 정산 권리를 가져갔다고 가정
      settled.add(`${DUEL_ID}:1`);

      const outcome = await service.expireRound(DUEL_ID, 1);

      // 'waiting'이 아니라 'settling' — 게이트웨이가 중복 알림을 보내지 않도록 구분한다
      expect(outcome?.status).toBe('settling');
      expect(duelsService.finishByGame).not.toHaveBeenCalled();
      expect(duelsService.voidByGame).not.toHaveBeenCalled();
    });

    it('마감 직전에 도착한 제출은 기권패로 처리되지 않는다', async () => {
      setSession(MiniGameType.TAP);
      await submit(CHALLENGER, 10);
      // 마감 타이머가 도는 사이 상대 제출이 들어온 상황. 점수 읽기가 권리 획득과 한
      // 연산이므로 그 스냅샷에 포함되고, 판정은 오직 이 스냅샷만 근거로 해야 한다 —
      // 마감 처리가 권리를 잡기 전에 따로 읽어두면 이 제출이 누락돼 기권패가 된다.
      redis.claimRoundSettlement.mockResolvedValueOnce({
        claimed: true,
        entries: new Map([
          [CHALLENGER, JSON.stringify({ primary: 10, tiebreak: 0, value: 10 })],
          [OPPONENT, JSON.stringify({ primary: 40, tiebreak: 0, value: 40 })],
        ]),
      });

      const outcome = await service.expireRound(DUEL_ID, 1);

      expect(outcome?.status).toBe('completed');
      expect(duelsService.finishByGame).toHaveBeenCalledWith(DUEL_ID, OPPONENT);
    });

    it('정산이 실패하면 권리를 반납해 다시 시도할 수 있게 둔다', async () => {
      setSession(MiniGameType.TAP);
      await submit(CHALLENGER, 10);
      duelsService.finishByGame.mockRejectedValueOnce(new Error('DB 장애'));

      await expect(service.expireRound(DUEL_ID, 1)).rejects.toThrow('DB 장애');
      expect(redis.releaseRoundSettlement).toHaveBeenCalledWith(DUEL_ID, 1);

      // 반납됐으므로 재시도가 정상적으로 정산된다
      const retry = await service.expireRound(DUEL_ID, 1);
      expect(retry?.status).toBe('completed');
      expect(duelsService.finishByGame).toHaveBeenLastCalledWith(
        DUEL_ID,
        CHALLENGER,
      );
    });
  });

  describe('expireRound — 장애 구분', () => {
    /**
     * "이미 끝난 결투"(정상)와 "DB/Redis 순간 장애"(비정상)를 뭉뚱그려 삼키면, 나중에
     * "결투가 이유 없이 멈췄다"는 리포트가 왔을 때 추적할 근거가 남지 않고 재시도 대상인지도
     * 알 수 없다. 정상 종료만 조용히 접고 장애는 올려 호출측(게이트웨이)이 재시도한다.
     */
    it('이미 끝난 결투는 조용히 접는다', async () => {
      setSession(MiniGameType.TAP);
      duelsService.getAcceptedDuel.mockRejectedValue(new ConflictException());

      await expect(service.expireRound(DUEL_ID, 1)).resolves.toBeNull();
    });

    it('세션이 만료됐으면 조용히 접는다', async () => {
      sessionRaw = null; // loadSession이 MINIGAME_NOT_ACTIVE(Conflict)를 던진다

      await expect(service.expireRound(DUEL_ID, 1)).resolves.toBeNull();
    });

    it('DB 장애는 삼키지 않고 올린다 (재시도 대상)', async () => {
      setSession(MiniGameType.TAP);
      duelsService.getAcceptedDuel.mockRejectedValue(new Error('DB 응답 없음'));

      await expect(service.expireRound(DUEL_ID, 1)).rejects.toThrow(
        'DB 응답 없음',
      );
    });

    it('Redis 장애도 삼키지 않고 올린다', async () => {
      (redis.get as jest.Mock).mockRejectedValue(new Error('Redis 응답 없음'));

      await expect(service.expireRound(DUEL_ID, 1)).rejects.toThrow(
        'Redis 응답 없음',
      );
    });
  });

  describe('스윕과의 경합', () => {
    /**
     * 확인이 기록보다 **뒤에** 온다. 앞에 두면 도착~기록 사이에 DB 왕복이 끼어, 그 수십 ms
     * 동안 마감 타이머가 먼저 정산할 때 제때 낸 제출이 기권패가 된다(submit 주석 참고).
     * VOID된 결투에 남은 Redis 항목은 정산될 일이 없고 TTL로 사라지므로 순서를 바꿔도
     * 잃는 것이 없다 — 클라이언트가 거부당한다는 사실이 중요하고, 그건 그대로다.
     */
    it('스윕이 이미 VOID를 커밋했으면 기록 여부와 무관하게 제출을 거부한다', async () => {
      setSession(MiniGameType.TAP);
      duelsService.markResultInProgress.mockRejectedValue(
        new ConflictException(),
      );

      await expect(submit(CHALLENGER, 10)).rejects.toThrow(ConflictException);
      // 정산으로는 이어지지 않는다 — 남은 항목은 TTL로 사라진다.
      expect(redis.claimRoundSettlement).not.toHaveBeenCalled();
    });

    /**
     * 이 PR이 없애려던 "부당한 패배"가 다른 형태로 돌아오는 경로다. 도착 시각을 먼저 찍어도,
     * 실제 기록이 DB 왕복 뒤라면 그 사이 마감 타이머가 정산해 제출이 스냅샷에서 빠진다.
     * 진 쪽은 기권패로 점수를 잃고 30분 페널티까지 받는데, 반환값은 에러가 아니라
     * 'settling'이라 이유조차 알 수 없다.
     */
    it('제출을 기록하기 전에는 DB를 다녀오지 않는다', async () => {
      setSession(MiniGameType.TAP);
      const order: string[] = [];
      duelsService.getAcceptedDuel.mockImplementation(() => {
        order.push('db');
        return Promise.resolve(duel);
      });
      duelsService.markResultInProgress.mockImplementation(() => {
        order.push('db');
        return Promise.resolve();
      });
      (redis.submitGameScore as jest.Mock).mockImplementation(() => {
        order.push('record');
        return Promise.resolve({ status: 'waiting' as const });
      });

      await submit(CHALLENGER, 10);

      expect(order[0]).toBe('record');
    });

    it('확정 직전에 스윕이 VOID를 선점하면 completed 대신 void로 알린다', async () => {
      setSession(MiniGameType.TAP);
      duelsService.finishByGame.mockResolvedValue({
        status: 'void',
        duel: { ...duel, status: DuelStatus.VOID },
      });

      await submit(CHALLENGER, 10);
      const outcome = await submit(OPPONENT, 20);

      expect(outcome.status).toBe('void');
    });
  });

  it('퀴즈 문제은행의 정답 인덱스는 모두 유효 범위 안에 있다', () => {
    for (const q of QUIZ_BANK) {
      expect(q.answerIndex).toBeGreaterThanOrEqual(0);
      expect(q.answerIndex).toBeLessThan(q.choices.length);
      expect(q.choices.length).toBeGreaterThan(1);
    }
  });
});
