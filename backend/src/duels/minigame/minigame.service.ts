import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Duel } from '../entities/duel.entity';
import { DuelsService } from '../duels.service';
import { RedisService } from '../../common/redis/redis.service';
import { ErrorCode, errBody } from '../../common/errors/error-code';
import { GameSubmitDto } from './dto/game-submit.dto';
import { LocalizedText, QuizQuestion, QUIZ_BANK } from './quiz-bank';
import {
  GAME_ROUND_TIMEOUT,
  GAME_SESSION_TTL,
  MAX_ROUNDS,
  FALSE_START_PRIMARY,
  MINI_GAME_TYPES,
  MiniGameType,
  NO_SUBMIT_PRIMARY,
  QUIZ_MAX_MS,
  QUIZ_MIN_READ_MS,
  REACTION_GO_MAX_MS,
  REACTION_GO_MIN_MS,
  REACTION_MAX_MS,
  REACTION_MIN_MS,
  TAP_DURATION_SEC,
  TAP_MAX,
} from './constants';

/**
 * Redis에 보관하는 세션 상태.
 *
 * 서버가 게임을 언제 시작시켰는지(startedAt) 스스로 기억하는 것이 이 설계의 핵심이다 —
 * 그래야 클라이언트가 보내온 "몇 ms 걸렸다"를 믿지 않고 직접 계산할 수 있다. 퀴즈 정답도
 * 여기에만 있고 클라이언트로 나가지 않는다.
 * (출발 신호 시각은 라운드 단위 별도 키에 있다 — goKey 주석 참고)
 */
interface GameSession {
  type: MiniGameType;
  round: number;
  /**
   * 참가자. duels 테이블에도 있지만 여기 복사해 둔다 — submit()이 참가자 확인을 위해
   * DB를 다녀오면 도착 시각과 실제 기록 사이에 수십 ms가 끼고, 그 사이 마감 타이머가
   * 먼저 정산하면 제때 낸 제출이 스냅샷에서 빠져 기권패가 된다(submit 주석 참고).
   * 라운드 진행 중에는 참가자가 바뀔 수 없으므로 복사본이 어긋날 일이 없다.
   */
  challengerId: string;
  opponentId: string;
  /** 서버 시계 기준 라운드 시작 시각 (epoch ms) */
  startedAt: number;
  /** 셔플 후 선택지 배열 기준의 정답 위치 (QUIZ 전용) */
  quizAnswerIndex?: number;
}

/** game:start 페이로드 — 두 참가자에게 동일하게 나간다. */
export interface GameStartPayload {
  duelId: number;
  gameType: MiniGameType;
  round: number;
  maxRounds: number;
  /** 제출 마감 시각 (epoch ms). 클라이언트가 남은 시간을 계산하는 데 쓴다. */
  deadlineAt: number;
  tap?: { durationSec: number };
  quiz?: { question: LocalizedText; choices: LocalizedText[] };
}

/**
 * 게이트웨이가 라운드를 여는 데 필요한 것 묶음.
 * goDelayMs는 payload와 분리돼 있다 — 신호까지 남은 시간을 클라이언트가 알면
 * 그 시각에 맞춰 미리 누를 수 있어 반응 속도 측정이 무의미해진다.
 */
export interface GameStartPlan {
  payload: GameStartPayload;
  /** REACTION일 때 game:go까지의 대기(ms). 다른 게임은 null. */
  goDelayMs: number | null;
}

/**
 * 서버가 비교에 쓰는 정규화 점수. 게임 종류가 달라도 이 두 값으로 통일해 비교한다.
 * - primary: 클수록 이긴다
 * - tiebreak: primary가 같으면 작을수록 이긴다
 */
interface NormalizedScore {
  primary: number;
  tiebreak: number;
}

/** Redis에 저장하는 라운드 점수 — 비교용 값과 결과 화면에 보여줄 값을 함께 담는다. */
interface StoredScore extends NormalizedScore {
  /** 표시용 값 (탭 수 / 서버가 잰 반응 ms / 고른 선택지 인덱스) */
  value: number | null;
  /** REACTION 전용 — 신호 전에 눌렀는지 */
  falseStart?: boolean;
}

/** 결과 공개용 — 상대가 실제로 무엇을 냈는지는 라운드가 끝난 뒤에만 나간다. */
export interface RevealedScore {
  userId: string;
  submitted: boolean;
  value: number | null;
  /** QUIZ 전용 — 정답이었는지 */
  correct?: boolean;
  /** REACTION 전용 — 부정출발로 최하점 처리됐는지 */
  falseStart?: boolean;
}

/** 결과를 누구에게 보낼지 게이트웨이가 알아야 해서 모든 outcome이 함께 들고 다닌다. */
export interface DuelParticipants {
  id: number;
  challengerId: string;
  opponentId: string;
}

export type MiniGameOutcome = { participants: DuelParticipants } &
  /** 상대가 아직 안 냈다 — 대기 UI를 띄우면 된다. */
  (| { status: 'waiting' }
    /**
     * 양쪽 다 냈지만 다른 쪽(마감 타이머 등)이 정산을 선점했다. 곧 그쪽이 결과를 보내므로
     * 여기서는 아무것도 emit하지 않는다 — 'waiting'과 섞으면 이미 끝난 라운드에 대해
     * 상대에게 "제출했다" 알림이 한 번 더 나간다.
     */
    | { status: 'settling' }
    /** 동점이라 재경기. plan을 그대로 startGameRound에 넘기면 된다. */
    | { status: 'rematch'; plan: GameStartPlan; scores: RevealedScore[] }
    /** duel에 winnerId·scoreDelta·allyBonusApplied가 확정되어 있다. */
    | { status: 'completed'; duel: Duel; scores: RevealedScore[] }
    | { status: 'void'; scores: RevealedScore[] }
  );

interface ParsedEntry {
  userId: string;
  score: NormalizedScore;
  value: number | null;
  submitted: boolean;
  falseStart: boolean;
}

@Injectable()
export class MinigameService {
  constructor(
    private readonly redis: RedisService,
    private readonly duelsService: DuelsService,
  ) {}

  private sessionKey(duelId: number): string {
    return `duel:game:${duelId}`;
  }

  /**
   * 출발 신호 시각은 세션과 **다른 키**에 라운드 단위로 둔다.
   *
   * 세션에 넣고 markGo가 읽어서 다시 쓰면 read-modify-write가 되는데, 그 사이에 재경기
   * 세션(start의 SET)이 끼면 방금 만든 라운드 세션이 낡은 사본으로 덮인다. 그러면 클라는
   * round 2 화면인데 서버 세션은 round 1이라 모든 제출이 라운드 불일치로 튕기고, 어느
   * 타이머도 정산하지 못해 결투가 스윕까지 매달린다. 별도 키 + SETNX면 그 창이 없다.
   */
  private goKey(duelId: number, round: number): string {
    return `duel:game:go:${duelId}:${round}`;
  }

  /** 라운드가 끝난 뒤의 정리 — 전부 TTL이 걸려 있어 실패해도 잃는 것이 없다. */
  private async cleanupSession(duelId: number, round: number): Promise<void> {
    await Promise.all([
      this.redis.del(this.sessionKey(duelId)),
      this.redis.del(this.goKey(duelId, round)),
    ]);
  }

  private async saveSession(
    duelId: number,
    session: GameSession,
  ): Promise<void> {
    await this.redis.set(
      this.sessionKey(duelId),
      JSON.stringify(session),
      GAME_SESSION_TTL,
    );
  }

  /**
   * 결투 수락 직후 미니게임 세션을 만든다 (게이트웨이가 duel:accepted 직후 호출).
   *
   * 게임 종류를 서버가 정하는 이유: 퀴즈 정답을 서버만 알아야 하고, 클라이언트가 종류를
   * 스스로 고르면 두 기기가 서로 다른 게임을 띄울 여지가 생긴다.
   */
  async start(
    participants: DuelParticipants,
    round = 1,
  ): Promise<GameStartPlan> {
    const duelId = participants.id;
    const type =
      MINI_GAME_TYPES[Math.floor(Math.random() * MINI_GAME_TYPES.length)];
    const startedAt = Date.now();
    const session: GameSession = {
      type,
      round,
      startedAt,
      challengerId: participants.challengerId,
      opponentId: participants.opponentId,
    };
    const payload: GameStartPayload = {
      duelId,
      gameType: type,
      round,
      maxRounds: MAX_ROUNDS,
      deadlineAt: startedAt + GAME_ROUND_TIMEOUT * 1000,
    };
    let goDelayMs: number | null = null;

    if (type === MiniGameType.TAP) {
      payload.tap = { durationSec: TAP_DURATION_SEC };
    } else if (type === MiniGameType.QUIZ) {
      const question = QUIZ_BANK[Math.floor(Math.random() * QUIZ_BANK.length)];
      const { choices, answerIndex } = this.shuffleChoices(question);
      session.quizAnswerIndex = answerIndex;
      payload.quiz = { question: question.question, choices };
    } else {
      goDelayMs =
        REACTION_GO_MIN_MS +
        Math.floor(Math.random() * (REACTION_GO_MAX_MS - REACTION_GO_MIN_MS));
    }

    await this.saveSession(duelId, session);
    return { payload, goDelayMs };
  }

  /**
   * 시작에 실패한 결투의 세션을 걷어낸다 (게이트웨이의 실패 처리 경로가 호출).
   *
   * 세션을 남기면 이미 걸린 go 타이머가 VOID된 결투에 대고 game:go를 쏘고, 키도 TTL이
   * 다 될 때까지 남는다. 정리 자체가 실패해도 TTL이 최종 안전망이다.
   */
  async discardSession(duelId: number, round = 1): Promise<void> {
    await this.cleanupSession(duelId, round).catch(() => undefined);
  }

  /**
   * 반응속도 게임의 출발 신호를 확정한다 (게이트웨이가 game:go를 emit하기 직전에 호출).
   *
   * 반드시 emit보다 **먼저** 호출해 goAt을 저장해야 한다 — 순서가 뒤집히면 신호를 받고
   * 즉시 누른 정상 제출이 "goAt이 아직 없음"으로 읽혀 부정출발 처리된다.
   */
  async markGo(duelId: number, round: number): Promise<boolean> {
    // 세션은 읽기만 한다 — 쓰지 않으므로 재경기 세션을 덮어쓸 수 없다(goKey 주석 참고).
    const session = await this.loadSession(duelId).catch(() => null);
    if (
      !session ||
      session.round !== round ||
      session.type !== MiniGameType.REACTION
    ) {
      return false;
    }
    // SETNX — 이미 쏜 라운드면 false. 두 번 쏴서 goAt이 밀리는 일이 없다.
    return this.redis.tryAcquireLock(
      this.goKey(duelId, round),
      GAME_SESSION_TTL,
      String(Date.now()),
    );
  }

  /**
   * 선택지를 섞고 정답이 옮겨간 위치를 함께 돌려준다 (Fisher-Yates).
   * 문제은행의 정답이 전부 0번이라, 섞지 않으면 첫 선택지만 찍어도 항상 맞는다.
   */
  private shuffleChoices(question: QuizQuestion): {
    choices: LocalizedText[];
    answerIndex: number;
  } {
    const choices = [...question.choices];
    let answerIndex = question.answerIndex;
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]];
      if (answerIndex === i) answerIndex = j;
      else if (answerIndex === j) answerIndex = i;
    }
    return { choices, answerIndex };
  }

  private async loadSession(duelId: number): Promise<GameSession> {
    const raw = await this.redis.get(this.sessionKey(duelId));
    if (!raw) {
      throw new ConflictException(
        errBody(
          ErrorCode.MINIGAME_NOT_ACTIVE,
          '진행 중인 미니게임이 없습니다.',
        ),
      );
    }
    return JSON.parse(raw) as GameSession;
  }

  /**
   * 라운드 결과 제출. 두 참가자가 모두 내면 그 자리에서 정산한다.
   *
   * 상대 점수는 정산 전까지 어떤 경로로도 반환하지 않는다 — 먼저 낸 쪽에게 상대 값을
   * 알려주면 그 값에 맞춰 자기 값을 조작할 수 있기 때문이다.
   */
  async submit(
    duelId: number,
    userId: string,
    dto: GameSubmitDto,
  ): Promise<MiniGameOutcome> {
    // 도착 시각을 가장 먼저 찍는다 — 뒤이은 왕복이 측정에 섞이지 않도록.
    const arrivedAt = Date.now();

    // 여기부터 submitGameScore까지는 **Redis 왕복만** 둔다. 참가자 확인을 위해 DB를
    // 다녀오면 그 수십 ms 동안 마감 타이머가 먼저 정산할 수 있고, 그러면 제때 낸 제출이
    // 스냅샷에서 빠져 기권패 + 30분 페널티가 된다. 게다가 반환값은 에러가 아니라
    // 'settling'이라 진 쪽은 이유조차 알 수 없다. 그래서 참가자를 세션에 복사해 둔다.
    // 세션과 출발 신호 시각을 한 번에 읽는다 — REACTION이 아니면 뒤 값은 그냥 null이다.
    // 순차로 읽으면 기록까지의 왕복이 하나 더 늘어 위 경합 창이 그만큼 넓어진다.
    const [session, goRaw] = await Promise.all([
      this.loadSession(duelId),
      this.redis.get(this.goKey(duelId, dto.round)),
    ]);
    const participants: DuelParticipants = {
      id: duelId,
      challengerId: session.challengerId,
      opponentId: session.opponentId,
    };
    if (
      ![participants.challengerId, participants.opponentId].includes(userId)
    ) {
      throw new ForbiddenException(
        errBody(
          ErrorCode.DUEL_NOT_PARTICIPANT,
          '결투 참가자만 결과를 제출할 수 있습니다.',
        ),
      );
    }
    if (session.round !== dto.round) {
      throw new ConflictException(
        errBody(
          ErrorCode.MINIGAME_ROUND_MISMATCH,
          '이미 지난 라운드의 결과입니다.',
        ),
      );
    }

    const goAt = goRaw === null ? undefined : Number(goRaw);
    const score = this.evaluate(session, dto, arrivedAt, goAt);

    const stored = await this.redis.submitGameScore(
      duelId,
      session.round,
      userId,
      JSON.stringify(score),
      GAME_SESSION_TTL,
    );
    if (stored.status === 'duplicate') {
      throw new ConflictException(
        errBody(
          ErrorCode.MINIGAME_ALREADY_SUBMITTED,
          '이미 이번 라운드 결과를 제출했습니다.',
        ),
      );
    }

    // 스윕이 이 결투를 이미 VOID로 넘겼다면 여기서 거부된다. **기록 뒤에** 확인하는 것이
    // 중요하다 — 앞에 두면 위 경합이 되살아난다. VOID된 결투에 남은 Redis 항목은 정산될
    // 일이 없고 TTL로 사라지므로, 순서를 바꿔 잃는 것은 없다.
    await this.duelsService.markResultInProgress(duelId);

    if (stored.status === 'waiting') return { status: 'waiting', participants };

    return this.settle(participants, session);
  }

  /**
   * 제출 마감 처리 (게이트웨이의 라운드 타이머가 호출).
   *
   * 마감까지 내지 않은 쪽은 기권패가 된다 — 앱을 꺼서 패배를 회피하는 것을 막는다.
   * 이미 양쪽 제출로 정산이 끝났으면 settle의 락에 걸려 아무 일도 하지 않는다.
   */
  async expireRound(
    duelId: number,
    round: number,
  ): Promise<MiniGameOutcome | null> {
    // "이미 끝난 결투"(정상)와 "DB/Redis 순간 장애"(비정상)를 구분한다. 뭉뚱그려 삼키면
    // 나중에 "결투가 이유 없이 멈췄다"는 리포트가 왔을 때 추적할 근거가 남지 않고, 재시도
    // 대상인지도 알 수 없다. 정상 종료만 null로 접고 장애는 그대로 올려 호출측이 재시도한다.
    const duel = await this.duelsService
      .getAcceptedDuel(duelId)
      .catch((err: unknown) => {
        // 결투가 사라졌거나(NotFound) 이미 ACCEPTED가 아니면(Conflict) 마감할 것이 없다.
        if (
          err instanceof NotFoundException ||
          err instanceof ConflictException
        ) {
          return null;
        }
        throw err;
      });
    if (!duel) return null;

    const session = await this.loadSession(duelId).catch((err: unknown) => {
      // 세션 키 만료 = 이미 정산이 끝났다는 뜻이라 정상이다.
      if (err instanceof ConflictException) return null;
      throw err;
    });
    if (!session || session.round !== round) return null;

    return this.settle(duel, session);
  }

  /**
   * 라운드 승패를 가르고 결투를 확정한다.
   *
   * 마감 타이머와 "양쪽 제출 완료"가 동시에 도달할 수 있어, SET NX 락으로 둘 중 하나만
   * 정산하게 만든다 — 이게 없으면 같은 라운드가 두 번 정산돼 재경기가 중복 시작되거나
   * finishByGame이 두 번 호출된다(두 번째는 CAS에 걸리지만 알림은 두 번 나간다).
   */
  private async settle(
    duel: DuelParticipants,
    session: GameSession,
  ): Promise<MiniGameOutcome> {
    const claim = await this.redis.claimRoundSettlement(
      duel.id,
      session.round,
      GAME_SESSION_TTL,
    );
    if (!claim.claimed) return { status: 'settling', participants: duel };

    try {
      return await this.decide(duel, session, claim.entries);
    } catch (err) {
      // 정산이 끝나지 못했으면 권리를 돌려놔야 한다 — 그대로 두면 마감 타이머가 다시
      // 시도해도 '이미 정산 중'으로 튕겨, 클라이언트가 결과를 못 받고 결투 스윕까지 매달린다.
      await this.redis
        .releaseRoundSettlement(duel.id, session.round)
        .catch(() => undefined);
      throw err;
    }
  }

  /** 정산 권리를 확보한 뒤의 실제 판정 — 스냅샷은 락과 같은 원자 연산에서 읽은 값이다. */
  private async decide(
    duel: DuelParticipants,
    session: GameSession,
    entries: Map<string, string>,
  ): Promise<MiniGameOutcome> {
    const parsed = [duel.challengerId, duel.opponentId].map((userId) =>
      this.parseEntry(userId, entries.get(userId)),
    );

    const scores: RevealedScore[] = parsed.map((p) => ({
      userId: p.userId,
      submitted: p.submitted,
      value: p.value,
      ...(session.type === MiniGameType.QUIZ
        ? { correct: p.score.primary === 1 }
        : {}),
      ...(session.type === MiniGameType.REACTION
        ? { falseStart: p.falseStart }
        : {}),
    }));

    const [a, b] = parsed;
    const winnerId = this.pickWinner(a, b);

    if (winnerId) {
      const outcome = await this.duelsService.finishByGame(duel.id, winnerId);
      // 여기까지 오면 점수·원장·페널티가 **이미 커밋**됐다. 정리(TTL 걸린 키 삭제)가
      // 실패했다고 예외를 올리면 settle의 catch가 결과를 삼켜 아무도 duel:completed를
      // 받지 못하는데, 복구할 방법이 없다 — 재시도는 이미 COMPLETED인 결투를 보고
      // null을 돌려주고, 스윕은 PENDING/ACCEPTED만 건드린다. 점수만 움직이고 두
      // 클라이언트는 게임 화면에 갇힌다.
      await this.cleanupSession(duel.id, session.round).catch(() => undefined);
      return outcome.status === 'confirmed'
        ? {
            status: 'completed',
            duel: outcome.duel,
            scores,
            participants: duel,
          }
        : { status: 'void', scores, participants: duel };
    }

    // 아무도 안 낸 판은 재경기를 열어도 또 아무도 내지 않는다 — 곧바로 무효 처리한다.
    // (양쪽 부정출발처럼 둘 다 "냈지만 최하점"인 경우는 재경기를 준다)
    const bothAbsent = parsed.every((p) => !p.submitted);
    if (!bothAbsent && session.round < MAX_ROUNDS) {
      const plan = await this.start(duel, session.round + 1);
      return { status: 'rematch', plan, scores, participants: duel };
    }

    await this.duelsService.voidByGame(duel.id);
    // 위와 같은 이유로 정리 실패가 결과 통보를 막지 않는다.
    await this.cleanupSession(duel.id, session.round).catch(() => undefined);
    return { status: 'void', scores, participants: duel };
  }

  /** 미제출자는 어떤 정상 제출보다도 낮은 점수를 받는다 (기권패). */
  private parseEntry(userId: string, raw: string | undefined): ParsedEntry {
    if (!raw) {
      return {
        userId,
        score: {
          primary: NO_SUBMIT_PRIMARY,
          tiebreak: Number.MAX_SAFE_INTEGER,
        },
        value: null,
        submitted: false,
        falseStart: false,
      };
    }
    const stored = JSON.parse(raw) as StoredScore;
    return {
      userId,
      score: { primary: stored.primary, tiebreak: stored.tiebreak },
      value: stored.value,
      submitted: true,
      falseStart: stored.falseStart === true,
    };
  }

  /** primary가 큰 쪽 승, 같으면 tiebreak가 작은 쪽 승, 그것도 같으면 무승부(null). */
  private pickWinner(a: ParsedEntry, b: ParsedEntry): string | null {
    if (a.score.primary !== b.score.primary) {
      return a.score.primary > b.score.primary ? a.userId : b.userId;
    }
    if (a.score.tiebreak !== b.score.tiebreak) {
      return a.score.tiebreak < b.score.tiebreak ? a.userId : b.userId;
    }
    return null;
  }

  private invalidScore(message: string): BadRequestException {
    return new BadRequestException(
      errBody(ErrorCode.MINIGAME_INVALID_SCORE, message),
    );
  }

  /**
   * 제출을 비교 가능한 점수로 바꾼다. 시간이 걸린 값은 전부 서버 시계로 직접 잰다 —
   * 클라이언트가 보고한 소요 시간은 받지도, 쓰지도 않는다.
   *
   * 남는 신뢰 지점은 탭 횟수 하나뿐이다. 서버는 손가락을 볼 수 없어 이것만은 재현이
   * 불가능하고, 상한(TAP_MAX)과 최소 경과시간으로 완화만 한다.
   */
  private evaluate(
    session: GameSession,
    dto: GameSubmitDto,
    arrivedAt: number,
    /** 서버가 game:go를 쏜 시각. 아직 안 쐈으면 undefined (REACTION 전용). */
    goAt?: number,
  ): StoredScore {
    switch (session.type) {
      case MiniGameType.TAP: {
        if (dto.value === undefined) {
          throw this.invalidScore('탭 횟수가 필요합니다.');
        }
        if (dto.value > TAP_MAX) {
          throw this.invalidScore(
            `${TAP_DURATION_SEC}초 동안 낼 수 없는 탭 수입니다.`,
          );
        }
        // 게임 시간을 실제로 채웠는지 서버 시계로 확인한다. 네트워크 지연은 도착을
        // 늦추기만 하므로, 이보다 빨리 온 제출은 플레이하지 않고 만든 값이다.
        if (arrivedAt - session.startedAt < TAP_DURATION_SEC * 1000) {
          throw this.invalidScore('게임이 끝나기 전에 도착한 제출입니다.');
        }
        return { primary: dto.value, tiebreak: 0, value: dto.value };
      }

      case MiniGameType.REACTION: {
        // 신호 전에 누른 제출 = 부정출발. 최하점으로 확정한다 — 이게 없으면 계속
        // 두드려서 0ms를 만들 수 있고, HSETNX라 다시 낼 수도 없다.
        if (goAt === undefined || arrivedAt < goAt) {
          return {
            primary: FALSE_START_PRIMARY,
            tiebreak: Number.MAX_SAFE_INTEGER,
            value: null,
            falseStart: true,
          };
        }
        // 서버가 신호를 쏜 시각과 제출이 도착한 시각의 차이 — 클라이언트가 주장할 여지가 없다.
        // 대신 네트워크 왕복이 포함되므로, 사람이 낼 수 없는 값으로는 내려가지 않게 바닥을 둔다.
        const measured = Math.max(arrivedAt - goAt, REACTION_MIN_MS);
        return {
          primary: 0,
          tiebreak: Math.min(measured, REACTION_MAX_MS),
          value: measured,
        };
      }

      case MiniGameType.QUIZ: {
        if (dto.value === undefined) {
          throw this.invalidScore('선택한 답이 필요합니다.');
        }
        const correct = dto.value === session.quizAnswerIndex;
        // 문제를 보낸 시각부터 서버가 직접 잰다. 읽을 시간도 없이 도착한 정답은 찍은
        // 것이므로 QUIZ_MIN_READ_MS까지 끌어올려 속도 이점을 주지 않는다.
        const elapsed = Math.max(
          arrivedAt - session.startedAt,
          QUIZ_MIN_READ_MS,
        );
        // 오답자끼리는 응답 속도로 우열을 가리지 않는다 — 빨리 찍은 쪽이 이기면
        // 문제를 읽지 않고 아무거나 누르는 게 유리해진다. 둘 다 오답이면 무승부다.
        const tiebreak = correct ? Math.min(elapsed, QUIZ_MAX_MS) : QUIZ_MAX_MS;
        return { primary: correct ? 1 : 0, tiebreak, value: dto.value };
      }
    }
  }
}
