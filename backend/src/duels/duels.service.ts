import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Duel, DuelStatus } from './entities/duel.entity';
import { RedisService } from '../common/redis/redis.service';
import { UsersService } from '../users/users.service';
import { ScoresService } from '../scores/scores.service';
import { ModerationService } from '../moderation/moderation.service';
import { ScoreEventType } from '../scores/entities/score-event.entity';
import { sortedPairKey } from '../common/utils/pair-key.util';
import {
  ALLY_BONUS_MIN_COUNT,
  ALLY_BONUS_MULTIPLIER,
  BASE_DUEL_SCORE,
  DUEL_ACTIVE_TTL,
  DUEL_NO_RESPONSE_SCORE_PENALTY,
  DUEL_REJECT_SCORE_PENALTY,
  DUEL_SHIELD_TTL,
  DUEL_REQUEST_TTL,
  DUEL_RESULT_TTL,
  DUEL_SWEEP_GRACE,
  ENCOUNTER_RADIUS_M,
  PENALTY_TTL,
} from './constants';
import { ErrorCode, errBody } from '../common/errors/error-code';
import {
  PG_FOREIGN_KEY_VIOLATION,
  pgErrorCode,
} from '../common/utils/pg-error.util';

/**
 * 미니게임 판정으로 결투가 끝났을 때의 결과.
 * - confirmed: 승패가 확정되어 점수·페널티가 반영됨
 * - void: 무승부이거나, 확정 직전에 정리 잡이 VOID를 선점함 (점수 변동 없음)
 */
export type DuelFinishOutcome =
  | { status: 'void'; duel: Duel }
  | { status: 'confirmed'; duel: Duel };

/** 게이트웨이가 주입하는 알림 콜백 (온라인이면 즉시 emit, 아니면 Redis 큐잉) */
export type DuelNotifier = (
  userId: string,
  event: string,
  payload: unknown,
) => Promise<void>;

/**
 * 결투가 성립하지 못한 채 끝났을 때 양쪽에 보내는 공통 payload (duel:rejected·duel:expired).
 *
 * 수신자별로 다른 payload를 만들지 않는다 — 오프라인 참가자에게는 이 payload가 Redis 큐에
 * 그대로 쌓였다가 재접속 시 재생되는데, 수신자마다 형태가 다르면 큐에 넣는 시점의 "누구용"
 * 판단이 굳어버린다. 대신 누가 깎였는지를 penalizedUserId로 실어 클라이언트가 자기 id와
 * 비교하게 한다.
 *
 * 보호 기간은 남은 초가 아니라 **절대 시각**으로 보낸다. 큐 보관이 최대 30분
 * (NOTIFICATION_QUEUE_TTL)인데 상대 초를 보내면, 25분 뒤 접속한 신청자가 이미 15분 전에
 * 끝난 보호막에 대해 10분 카운트다운을 새로 시작하고 서버는 허용하는 재신청을 UI가 막는다.
 *
 * 차감이 없는 종료(탈퇴로 끝난 결투, VOID)는 scoreDelta가 비어 있어 전부 0/null이 된다.
 */
export function duelPenaltyPayload(row: {
  id: number;
  opponentId: string | null;
  scoreDelta?: number | null;
}): {
  duelId: number;
  scorePenalty: number;
  penalizedUserId: string | null;
  shieldUntil: string | null;
} {
  const scorePenalty = row.scoreDelta ?? 0;
  const penalized = scorePenalty > 0;
  return {
    duelId: row.id,
    scorePenalty,
    // 결투 페널티는 언제나 "신청을 성립시키지 못한 쪽" = opponentId가 진다.
    penalizedUserId: penalized ? row.opponentId : null,
    // 보호막은 점수를 문 순간(수 ms 전) 걸렸으므로 지금 기준으로 계산해도 오차가 없다.
    shieldUntil: penalized
      ? new Date(Date.now() + DUEL_SHIELD_TTL * 1000).toISOString()
      : null,
  };
}

const ACTIVE_STATUSES = [DuelStatus.PENDING, DuelStatus.ACCEPTED];

// 참가자 id는 DB가 nullable이다(탈퇴 시 SET NULL). 엔티티 쪽은 진행 중인 결투만 읽는다는
// 전제로 string을 유지하지만, 여기 오는 행은 상태 전이 결과라 그 전제가 약하다 — null을
// 그대로 lockKey/notifier에 넘기면 조용히 쓰레기 키를 만들고 null에게 알림을 보내므로
// 타입으로 드러내 호출부가 걸러내게 한다.
type SweptDuelRow = {
  id: number;
  challengerId: string | null;
  opponentId: string | null;
  // 이 전이로 실제 깎인 점수의 크기. 무응답 만료에서만 채워지고, 탈퇴로 끝난 결투처럼
  // 아무도 책임이 없는 종료에서는 null이다 — 알림 payload가 이 값으로 갈린다.
  scoreDelta?: number | null;
  // 탈퇴 종료 경로에서만 채운다 — EXPIRED/VOID를 한 배열로 넘기고 알림 때 다시 가른다.
  event?: string;
};

/** 결투를 성립시키지 못한 쪽에 물리는 개인 점수 차감 1건 (거절·무응답 공통). */
type DuelPenaltyCharge = {
  duelId: number;
  userId: string;
  team: string;
  /** 깎을 크기(양수). 원장에는 -points로 남는다. */
  points: number;
  type: ScoreEventType;
};

@Injectable()
export class DuelsService {
  private readonly logger = new Logger(DuelsService.name);

  constructor(
    @InjectRepository(Duel)
    private readonly duelRepo: Repository<Duel>,
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly usersService: UsersService,
    private readonly scoresService: ScoresService,
    private readonly moderation: ModerationService,
  ) {}

  private lockKey(a: string, b: string): string {
    return sortedPairKey('duel:lock', a, b);
  }

  // 정리 잡(프로세서)은 게이트웨이에 접근할 수 없어(모듈 순환), 게이트웨이가 기동 시 콜백을 주입한다.
  private notifier: DuelNotifier | null = null;

  setNotifier(notifier: DuelNotifier): void {
    this.notifier = notifier;
  }

  /**
   * 두 좌표 집합이 실제로 반경 내에 있는지 PostGIS geography로 정밀 검증.
   * Redis GEO(BYRADIUS)는 구면 근사라 경계값 근처에서 오차가 날 수 있어 narrow-phase로 재확인한다.
   */
  private async verifyProximityBatch(
    originLat: number,
    originLng: number,
    candidates: { id: string; lat: number; lng: number }[],
    radiusM: number,
  ): Promise<Set<string>> {
    if (candidates.length === 0) return new Set();
    const rows = await this.dataSource.query<{ id: string; within: boolean }[]>(
      `SELECT c.id, ST_DWithin(
         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
         ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326)::geography,
         $3
       ) AS within
       FROM unnest($4::text[], $5::float8[], $6::float8[]) AS c(id, lat, lng)`,
      [
        originLng,
        originLat,
        radiusM,
        candidates.map((c) => c.id),
        candidates.map((c) => c.lat),
        candidates.map((c) => c.lng),
      ],
    );
    return new Set(rows.filter((r) => r.within).map((r) => r.id));
  }

  private async verifyProximity(
    aUserId: string,
    bUserId: string,
  ): Promise<boolean> {
    const [posA, posB] = await Promise.all([
      this.redis.geoPos(aUserId),
      this.redis.geoPos(bUserId),
    ]);
    if (!posA || !posB) return false;
    const verified = await this.verifyProximityBatch(
      posA.lat,
      posA.lng,
      [{ id: bUserId, ...posB }],
      ENCOUNTER_RADIUS_M,
    );
    return verified.has(bUserId);
  }

  /** 위치 갱신 시 반경 내 상대 팀 유저 탐지 (broad-phase Redis GEO + narrow-phase PostGIS) */
  async findNearbyOpponents(
    userId: string,
    team: string,
    lat: number,
    lng: number,
  ): Promise<{ userId: string; team: string }[]> {
    const candidateIds = (
      await this.redis.geoSearch(lat, lng, ENCOUNTER_RADIUS_M)
    ).filter((id) => id !== userId);
    if (candidateIds.length === 0) return [];

    const metaEntries = await Promise.all(
      candidateIds.map(
        async (id) => [id, await this.redis.getUserMeta(id)] as const,
      ),
    );
    const opponentTeamById = new Map(
      metaEntries
        .filter(([, meta]) => meta && meta.team !== team)
        .map(([id, meta]) => [id, meta!.team]),
    );
    if (opponentTeamById.size === 0) return [];

    const positions = await this.redis.geoPosMany([...opponentTeamById.keys()]);
    const candidates = [...opponentTeamById.keys()]
      .filter((id) => positions.has(id))
      .map((id) => ({ id, ...positions.get(id)! }));

    const verifiedIds = await this.verifyProximityBatch(
      lat,
      lng,
      candidates,
      ENCOUNTER_RADIUS_M,
    );
    return [...verifiedIds].map((id) => ({
      userId: id,
      team: opponentTeamById.get(id)!,
    }));
  }

  async requestDuel(
    challenger: { id: string; team: string },
    targetUserId: string,
  ): Promise<Duel> {
    if (challenger.id === targetUserId) {
      throw new BadRequestException(
        errBody(
          ErrorCode.DUEL_SELF_CHALLENGE,
          '자기 자신에게 결투를 신청할 수 없습니다.',
        ),
      );
    }

    const target = await this.usersService.findById(targetUserId);
    if (!target)
      throw new NotFoundException(
        errBody(
          ErrorCode.DUEL_TARGET_NOT_FOUND,
          '상대 유저를 찾을 수 없습니다.',
        ),
      );
    if (target.team === challenger.team) {
      throw new BadRequestException(
        errBody(
          ErrorCode.DUEL_SAME_TEAM,
          '같은 팀에게는 결투를 신청할 수 없습니다.',
        ),
      );
    }

    if (await this.redis.hasPenalty(challenger.id)) {
      throw new ForbiddenException(
        errBody(
          ErrorCode.DUEL_CHALLENGER_PENALTY,
          '결투 페널티 중에는 결투를 신청할 수 없습니다.',
        ),
      );
    }
    if (await this.redis.hasPenalty(targetUserId)) {
      throw new ForbiddenException(
        errBody(ErrorCode.DUEL_TARGET_PENALTY, '상대가 결투 페널티 중입니다.'),
      );
    }

    // 직전 결투를 거절했거나 무응답으로 만료시켜 보호 기간 중인 상대는 건드릴 수 없다.
    // 응답하지 않은 쪽에 점수를 물리는 만큼 "물어도 곧바로 다시 걸린다"면 그 페널티가
    // 무한히 반복돼 순수한 출혈이 된다.
    // 신청자 본인의 보호막은 여기서 보지 않는다 — 보호막은 "남이 나에게 못 건다"일 뿐이고,
    // 본인이 먼저 거는 건 허용된다(대신 아래에서 그 순간 해제된다).
    //
    // 이 조회와 아래 생성 트랜잭션 사이에 상대가 거절을 커밋하면 이 신청은 그대로 통과한다
    // (Redis 보호막과 Postgres 트랜잭션은 함께 잠글 수 없다). 창은 수 ms고 결과는 결투 한
    // 번이 더 성립하는 것뿐이라, advisory lock 안으로 끌어들이는 대신 그대로 둔다.
    const targetShieldTtl = await this.redis.getDuelShieldTtl(targetUserId);
    if (targetShieldTtl > 0) {
      throw new ForbiddenException(
        errBody(
          ErrorCode.DUEL_TARGET_SHIELDED,
          `상대가 결투 거절 보호 중입니다. (약 ${Math.ceil(targetShieldTtl / 60)}분 후 해제)`,
        ),
      );
    }

    // 나를 차단한 상대에게는 결투를 걸 수 없다. 차단을 채팅에만 걸면, 차단당한 쪽이
    // 물리적으로 따라다니며 duel:request를 반복해 duel:requested 알림으로 계속
    // 접촉할 수 있어 "악성 사용자 차단"이 반쪽이 된다.
    // 거부 사유는 차단 사실을 드러내지 않는다 — 알려주면 차단 여부를 탐지하는 수단이 된다.
    const blockedBy = await this.moderation.getBlockedBy(challenger.id);
    if (blockedBy.includes(targetUserId)) {
      throw new ForbiddenException(
        errBody(
          ErrorCode.DUEL_TARGET_UNAVAILABLE,
          '지금은 이 상대에게 결투를 신청할 수 없습니다.',
        ),
      );
    }

    // geo:users의 좌표는 유저가 끊긴 뒤에도 스윕 전까지 남아있을 수 있으므로,
    // TTL로 관리되는 메타(접속 중 유저만 존재)로 "현재 접속 중"인지 먼저 확인한다.
    const targetMeta = await this.redis.getUserMeta(targetUserId);
    if (!targetMeta) {
      throw new BadRequestException(
        errBody(
          ErrorCode.DUEL_TARGET_LOCATION_UNKNOWN,
          '상대의 위치 정보를 확인할 수 없습니다. 상대가 접속 중인지 확인해주세요.',
        ),
      );
    }

    const inRange = await this.verifyProximity(challenger.id, targetUserId);
    if (!inRange) {
      throw new BadRequestException(
        errBody(
          ErrorCode.DUEL_OUT_OF_RANGE,
          `반경 ${ENCOUNTER_RADIUS_M}m 이내에 있어야 결투를 신청할 수 있습니다.`,
        ),
      );
    }

    // 유저 단위 배타성: 페어 락은 같은 두 유저 조합만 막으므로, 서로 다른 상대와의
    // 동시 결투는 여기서 차단한다. 확인~저장 사이 레이스로 같은 유저의 활성 결투가 2개
    // 생기지 않도록(스윕은 시간 기반이라 이런 중복을 감지하지 못한다), 참가자 id별
    // advisory lock으로 확인과 저장을 직렬화한다. 부분 유니크 인덱스는 한 유저가
    // challenger와 opponent로 엇갈려 등장하는 동시 신청을 막지 못해 이 방식을 쓴다.
    const participantIds = [challenger.id, targetUserId];
    const duel = await this.dataSource
      .transaction(async (manager) => {
        // 트랜잭션 종료 시 자동 해제. id 정렬로 락 획득 순서를 고정해 교차 신청 간 데드락 방지.
        for (const id of [...participantIds].sort()) {
          await manager.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [`duel:user:${id}`],
          );
        }
        const hasActiveDuel = await manager.exists(Duel, {
          where: [
            { challengerId: In(participantIds), status: In(ACTIVE_STATUSES) },
            { opponentId: In(participantIds), status: In(ACTIVE_STATUSES) },
          ],
        });
        if (hasActiveDuel) {
          throw new ConflictException(
            errBody(
              ErrorCode.DUEL_ALREADY_ACTIVE,
              '본인 또는 상대가 이미 진행 중인 결투가 있습니다.',
            ),
          );
        }

        // 락보다 DB row를 먼저 만들어, row의 id를 락의 소유권 토큰으로 사용한다.
        // (락 획득 실패 시 방금 만든 row만 지우면 되므로 롤백이 단순해진다)
        return manager.save(
          manager.create(Duel, {
            challengerId: challenger.id,
            opponentId: targetUserId,
            status: DuelStatus.PENDING,
          }),
        );
      })
      // 위 사전 검문(findById·getUserMeta·verifyProximity)은 전부 트랜잭션 밖이라, 그것들이
      // 끝난 뒤 advisory lock을 기다리는 동안 대상이 탈퇴를 완료할 수 있다. 그러면 INSERT가
      // 이미 사라진 users.id를 참조해 FK 위반(23503)이 나는데, 잡지 않으면 QueryFailedError가
      // 그대로 새어나가 신청자가 404 대신 500을 받는다.
      //
      // resolveDuel과 달리 SAVEPOINT는 필요 없다 — 이 트랜잭션의 유일한 쓰기가 이 INSERT라
      // 통째로 롤백되는 것이 맞다(부분 반영이 남지 않는다).
      // 이론상 challengerId 쪽 위반(신청자가 자기 계정을 동시에 지운 경우)도 같은 코드로
      // 오지만, 그때는 토큰이 이미 죽어 다음 요청부터 인증에서 막힌다.
      .catch((err: unknown) => {
        if (pgErrorCode(err) !== PG_FOREIGN_KEY_VIOLATION) throw err;
        throw new NotFoundException(
          errBody(
            ErrorCode.DUEL_TARGET_NOT_FOUND,
            '상대 유저를 찾을 수 없습니다.',
          ),
        );
      });

    const acquired = await this.redis.tryAcquireLock(
      this.lockKey(challenger.id, targetUserId),
      DUEL_REQUEST_TTL,
      String(duel.id),
    );
    if (!acquired) {
      await this.duelRepo.delete(duel.id);
      throw new ConflictException(
        errBody(
          ErrorCode.DUEL_ALREADY_PENDING,
          '이미 진행 중인 결투 요청이 있습니다.',
        ),
      );
    }

    // 스스로 결투를 건 순간 자기 보호막은 걷힌다 — 보호막 뒤에 숨어 일방적으로 공격만
    // 하는 것을 막는 규칙이다. 신청이 **실제로 성립한 뒤에** 푼다: 사거리 밖·중복 신청
    // 등으로 튕긴 시도까지 공격으로 세면 실수 한 번에 보호가 날아간다.
    //
    // 실패해도 예외를 올리지 않는다. 결투는 이미 만들어졌고 락도 잡혔는데 여기서 던지면
    // 신청자는 500을 받지만 결투는 살아 있어, 만료(30초)까지 아무것도 못 하게 된다.
    // 보호막이 남는 쪽의 손해는 "이 유저가 조금 더 오래 보호받는다"뿐이다.
    try {
      if (await this.redis.clearDuelShield(challenger.id)) {
        this.logger.log(
          `결투 신청으로 거절 보호 해제 userId=${challenger.id} duelId=${duel.id}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `거절 보호 해제 실패 userId=${challenger.id} duelId=${duel.id}: ${(err as Error).message}`,
      );
    }

    return duel;
  }

  async respondDuel(
    duelId: number,
    responderId: string,
    accept: boolean,
  ): Promise<Duel> {
    const duel = await this.duelRepo.findOne({ where: { id: duelId } });
    if (!duel)
      throw new NotFoundException(
        errBody(ErrorCode.DUEL_NOT_FOUND, '결투를 찾을 수 없습니다.'),
      );
    if (duel.opponentId !== responderId) {
      throw new ForbiddenException(
        errBody(
          ErrorCode.DUEL_NOT_RECIPIENT,
          '본인에게 온 결투 요청만 응답할 수 있습니다.',
        ),
      );
    }

    return accept ? this.acceptDuel(duel) : this.rejectDuel(duel);
  }

  /**
   * PENDING -> ACCEPTED. 페어 락을 응답 대기(30초)에서 대전 시간(DUEL_ACTIVE_TTL)으로 늘린다.
   */
  private async acceptDuel(duel: Duel): Promise<Duel> {
    // PENDING일 때만 전이하는 조건부 UPDATE로 accept/reject/expire 동시 요청 경쟁을 DB 레벨에서 막는다.
    const updateResult = await this.duelRepo
      .createQueryBuilder()
      .update(Duel)
      // respondedAt은 DB 시계로 기록한다 — requestedAt(@CreateDateColumn, DB now())과
      // sweepStaleDuels의 컷오프(DB now() 기준)가 같은 시계를 쓰도록 통일 (앱-DB 타임존 차이 방어)
      .set({
        status: DuelStatus.ACCEPTED,
        respondedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where('id = :id AND status = :pending', {
        id: duel.id,
        pending: DuelStatus.PENDING,
      })
      .execute();
    if (updateResult.affected === 0) {
      throw new ConflictException(
        errBody(ErrorCode.DUEL_ALREADY_HANDLED, '이미 처리된 결투입니다.'),
      );
    }

    const extended = await this.redis.extendLock(
      this.lockKey(duel.challengerId, duel.opponentId),
      DUEL_ACTIVE_TTL,
      String(duel.id),
    );
    if (!extended) {
      this.logger.warn(`결투 락 연장 실패 duelId=${duel.id} (이미 만료됨)`);
    }

    duel.status = DuelStatus.ACCEPTED;
    duel.respondedAt = new Date(); // 실제 값은 DB CURRENT_TIMESTAMP — 반환 객체용 근사치
    return duel;
  }

  /**
   * 점수를 문 쪽에 보호 기간을 부여한다 (거절·무응답 공통). **커밋 뒤에** 호출할 것 —
   * 롤백된 전이의 유저를 보호해두면 안 된다.
   *
   * 실패해도 예외를 올리지 않는다. 호출 시점엔 상태 전이와 점수 차감이 이미 커밋돼 있어,
   * 여기서 던지면 종료 알림이 통째로 막히고 클라이언트가 대기 화면에 갇힌다. 보호막을
   * 놓치면 그 유저가 조금 일찍 다시 걸릴 뿐 상태는 어긋나지 않는다.
   */
  private async grantShields(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const results = await Promise.allSettled(
      userIds.map((id) => this.redis.setDuelShield(id, DUEL_SHIELD_TTL)),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      this.logger.warn(
        `결투 보호막 설정 ${failed}건 실패 (해당 유저가 조금 일찍 다시 걸릴 뿐)`,
      );
    }
  }

  /**
   * 개인 점수 차감 + 원장 append를 한 번에 처리한다 (거절·무응답 공통).
   * **반드시 상태 전이 CAS와 같은 트랜잭션(manager)에서 호출할 것** — 상태만 넘어가고
   * 차감이 빠지거나 그 반대인 부분 반영을 만들지 않기 위해서다.
   *
   * 원장 insert는 resolveDuel과 같은 이유로 SAVEPOINT로 감싼다. 대상 유저가 이 사이에
   * 탈퇴하면 FK 위반(23503)이 나는데, Postgres는 실패한 문이 트랜잭션 전체를 abort시켜
   * 스윕 배치라면 한 명 때문에 그 회차 전부가 날아간다. 그 한 행만 건너뛰고 나머지는
   * 그대로 커밋한다.
   *
   * insert에서 외부 상태에 달린 FK는 userId뿐이다 — duelId는 같은 트랜잭션이 방금 갱신한
   * 행이라 반드시 존재하고 spotId는 넘기지 않는다. 그래서 23503을 "유저가 사라짐"으로
   * 읽어도 다른 원인을 삼키지 않는다.
   */
  private async chargeDuelPenalties(
    manager: EntityManager,
    charges: DuelPenaltyCharge[],
  ): Promise<void> {
    for (const charge of charges) {
      // 실제로 깎인 결투에만 scoreDelta를 남긴다. 전이 UPDATE에서 일괄로 세팅하면, 상대가
      // 이미 탈퇴해 charge가 만들어지지 않은 행에도 "2점 깎임"이 박혀 DB와 알림 payload가
      // 일어나지 않은 차감을 주장하게 된다.
      await manager.update(Duel, charge.duelId, { scoreDelta: charge.points });

      await this.usersService.applyScoreDelta(
        charge.userId,
        -charge.points,
        manager,
      );

      // 개인 랭킹은 users.score가 아니라 SUM(score_events.personalPoints)로 산출되므로
      // 원장에도 남겨야 두 값이 어긋나지 않는다. teamPoints는 다른 결투 이벤트와 같이 0 —
      // 결투 페널티가 팀 점수를 깎는 일은 없다(기획 확정).
      await manager.query('SAVEPOINT duel_penalty_ledger');
      try {
        await this.scoresService.record(manager, {
          userId: charge.userId,
          team: charge.team,
          type: charge.type,
          personalPoints: -charge.points,
          teamPoints: 0,
          duelId: charge.duelId,
        });
        await manager.query('RELEASE SAVEPOINT duel_penalty_ledger');
      } catch (err) {
        if (pgErrorCode(err) !== PG_FOREIGN_KEY_VIOLATION) throw err;
        await manager.query('ROLLBACK TO SAVEPOINT duel_penalty_ledger');
        this.logger.warn(
          `결투 페널티 원장 append 생략 — 유저가 사라짐 duelId=${charge.duelId} userId=${charge.userId}`,
        );
      }
    }
  }

  /**
   * 응답 없이 만료된 신청에서, 응답하지 않은 쪽(opponentId)의 차감 목록을 만든다.
   *
   * 팀은 원장에 남길 "이벤트 시점의 팀"이다. 이 조회는 상태 전이 CAS와 **같은 트랜잭션**
   * 안에서 일어나므로 manager를 반드시 넘긴다 — 기본 리포지토리로 읽으면 트랜잭션이
   * 커넥션을 쥔 채 풀에서 두 번째 커넥션을 잡아, 만료 타이머가 풀 크기만큼 동시에
   * 발화하면 전원이 서로를 기다리다 멈춘다(UsersService.findByIds 주석).
   */
  private async buildNoResponseCharges(
    manager: EntityManager,
    rows: SweptDuelRow[],
  ): Promise<DuelPenaltyCharge[]> {
    const responderIds = [
      ...new Set(
        rows
          .map((row) => row.opponentId)
          .filter((id): id is string => id !== null),
      ),
    ];
    if (responderIds.length === 0) return [];

    const teamById = new Map(
      (await this.usersService.findByIds(responderIds, manager)).map((u) => [
        u.id,
        u.team,
      ]),
    );
    return rows.flatMap((row) => {
      const team = row.opponentId ? teamById.get(row.opponentId) : undefined;
      // 팀을 못 읽었으면(= 유저가 이미 사라졌으면) 깎을 대상 자체가 없다.
      if (!row.opponentId || team === undefined) return [];
      return [
        {
          duelId: row.id,
          userId: row.opponentId,
          team,
          points: DUEL_NO_RESPONSE_SCORE_PENALTY,
          type: ScoreEventType.DUEL_NO_RESPONSE,
        },
      ];
    });
  }

  /**
   * PENDING -> REJECTED. 거절에는 두 가지 대가/보상이 함께 붙는다.
   * - 거절한 쪽의 개인 점수를 DUEL_REJECT_SCORE_PENALTY만큼 깎는다 (원장에도 남긴다)
   * - 대신 DUEL_SHIELD_TTL 동안 아무도 그 유저에게 결투를 걸 수 없다 (보호 기간)
   *
   * 상태 전이(CAS)와 점수 차감·원장 append를 한 트랜잭션으로 묶는 이유는 resolveDuel과
   * 같다 — REJECTED로 고정된 행에 차감만 빠지거나, 차감만 되고 상태는 PENDING인 채로
   * 남는 부분 반영을 만들지 않기 위해서다.
   *
   * 차감·원장은 무응답 만료(expireDuel·sweepStaleDuels)와 같은 경로를 쓴다
   * (chargeDuelPenalties) — 금액과 원장 형태가 두 곳에서 갈리지 않도록.
   */
  private async rejectDuel(duel: Duel): Promise<Duel> {
    const responderId = duel.opponentId;
    // 원장에 남길 이벤트 시점의 팀 (resolveDuel과 같은 이유로 트랜잭션 밖에서 미리 읽는다).
    const responder = await this.usersService.findById(responderId);

    // 거절에는 승자가 없다 — winnerId/loserId는 비워둔다. scoreDelta는 차감이 실제로
    // 일어났을 때만 chargeDuelPenalties가 채운다.
    // 팀을 못 읽었으면 유저가 이미 사라진 것이라 깎을 대상 자체가 없다.
    const charges: DuelPenaltyCharge[] = responder
      ? [
          {
            duelId: duel.id,
            userId: responderId,
            team: responder.team,
            points: DUEL_REJECT_SCORE_PENALTY,
            type: ScoreEventType.DUEL_REJECT,
          },
        ]
      : [];

    const claimed = await this.dataSource.transaction(async (manager) => {
      const updateResult = await manager
        .createQueryBuilder()
        .update(Duel)
        .set({
          status: DuelStatus.REJECTED,
          respondedAt: () => 'CURRENT_TIMESTAMP',
        })
        .where('id = :id AND status = :pending', {
          id: duel.id,
          pending: DuelStatus.PENDING,
        })
        .execute();
      if (updateResult.affected === 0) return false;

      await this.chargeDuelPenalties(manager, charges);
      return true;
    });

    if (!claimed) {
      throw new ConflictException(
        errBody(ErrorCode.DUEL_ALREADY_HANDLED, '이미 처리된 결투입니다.'),
      );
    }

    // 여기부터는 커밋 뒤다. 보호막을 커밋 전에 걸면 롤백된 거절에도 보호막이 남는다.
    // 그리고 이 지점 이후로는 무엇도 예외를 올리면 안 된다 — 거절과 -2점은 이미 확정됐는데
    // 여기서 던지면 응답자는 에러 ack만 받고 duel:rejected를 못 받으며, 신청자에게도
    // 알림이 가지 않는다. 재시도는 409고 30초 타이머의 expireDuel도 PENDING이 아니라
    // null을 돌려주므로, 두 사람 다 종료 이벤트를 영영 못 받고 대기 화면에 갇힌다.
    await this.grantShields(charges.map((c) => c.userId));
    await this.releasePairLockQuietly(duel);

    duel.status = DuelStatus.REJECTED;
    duel.scoreDelta = charges[0]?.points ?? null;
    duel.respondedAt = new Date(); // 실제 값은 DB CURRENT_TIMESTAMP — 반환 객체용 근사치
    return duel;
  }

  /** PENDING 상태로 DUEL_REQUEST_TTL이 지나도 응답 없으면 게이트웨이 타이머가 호출 */
  async expireDuel(duelId: number): Promise<Duel | null> {
    const duel = await this.duelRepo.findOne({ where: { id: duelId } });
    if (!duel) return null;

    // 무응답도 거절과 같은 금액을 깎는다 — 그렇지 않으면 "무시가 더 싸다"가 되어
    // 거절 페널티를 회피하는 지배 전략이 생긴다(constants.ts 참고). 대신 보호 기간은
    // 주지 않아, 같은 값을 내고도 거절 버튼을 누르는 쪽이 항상 유리하다.
    //
    // 상태 전이와 차감을 한 트랜잭션으로 묶는 이유는 rejectDuel과 같다.
    const charges = await this.dataSource.transaction(async (manager) => {
      // respondDuel과 동일하게 조건부 UPDATE로 처리해, accept가 동시에 들어와도 둘 중 하나만 반영된다.
      const updateResult = await manager
        .createQueryBuilder()
        .update(Duel)
        .set({ status: DuelStatus.EXPIRED })
        .where('id = :id AND status = :pending', {
          id: duelId,
          pending: DuelStatus.PENDING,
        })
        .returning('id, "challengerId", "opponentId"')
        .execute();
      if (updateResult.affected === 0) return null;

      const applied = await this.buildNoResponseCharges(
        manager,
        updateResult.raw as SweptDuelRow[],
      );
      await this.chargeDuelPenalties(manager, applied);
      return applied;
    });
    if (charges === null) return null;

    // 여기부터는 커밋 뒤다 — 락 해제로 예외를 올리면 만료가 이미 확정된 결투의 종료
    // 알림을 아무도 못 보내 두 클라이언트가 대기 화면에 갇힌다(releasePairLockQuietly 주석).
    await this.grantShields(charges.map((c) => c.userId));
    await this.releasePairLockQuietly(duel);

    duel.status = DuelStatus.EXPIRED;
    duel.scoreDelta = charges[0]?.points ?? null;
    return duel;
  }

  /** ACCEPTED 상태의 결투를 읽어온다 — 미니게임 세션 시작·점수 제출의 공통 전제 확인. */
  async getAcceptedDuel(duelId: number): Promise<Duel> {
    const duel = await this.duelRepo.findOne({ where: { id: duelId } });
    if (!duel)
      throw new NotFoundException(
        errBody(ErrorCode.DUEL_NOT_FOUND, '결투를 찾을 수 없습니다.'),
      );
    if (duel.status !== DuelStatus.ACCEPTED) {
      throw new ConflictException(
        errBody(
          ErrorCode.DUEL_NOT_ACCEPTED,
          '수락된 결투만 미니게임을 진행할 수 있습니다.',
        ),
      );
    }
    return duel;
  }

  /**
   * 결과 처리가 진행 중임을 DB 시계로 스탬프하는 조건부 UPDATE (미니게임 점수 제출 시 호출).
   * 두 역할을 겸한다:
   * 1) sweepStaleDuels가 이 스탬프가 신선한 동안 VOID를 유예하므로, 양측이 실제로 게임을
   *    진행 중인 결투가 타이밍상 스윕에 선점되어 결과가 버려지지 않는다
   * 2) 스윕이 이미 VOID를 커밋한 뒤라면 affected=0으로 즉시 거부되어, 제출이 Redis에만
   *    기록된 채 유실되는 일이 없다 (단순 status 조회와 달리 원자적)
   */
  async markResultInProgress(duelId: number): Promise<void> {
    const stamped = await this.duelRepo
      .createQueryBuilder()
      .update(Duel)
      .set({ resultReportedAt: () => 'CURRENT_TIMESTAMP' })
      .where('id = :id AND status = :accepted', {
        id: duelId,
        accepted: DuelStatus.ACCEPTED,
      })
      .execute();
    if (stamped.affected === 0) {
      throw new ConflictException(
        errBody(
          ErrorCode.DUEL_NOT_ACCEPTED,
          '수락된 결투만 미니게임을 진행할 수 있습니다.',
        ),
      );
    }
  }

  /**
   * 미니게임 판정으로 나온 승자를 결투 결과로 확정한다.
   *
   * 승자는 서버가 두 참가자의 점수를 비교해 정한 값이어야 한다 — 클라이언트가 보낸
   * 승패 주장을 그대로 넘기면 안 된다(자가신고 시절의 취약점).
   */
  async finishByGame(
    duelId: number,
    winnerId: string,
  ): Promise<DuelFinishOutcome> {
    const duel = await this.getAcceptedDuel(duelId);
    if (![duel.challengerId, duel.opponentId].includes(winnerId)) {
      throw new BadRequestException(
        errBody(
          ErrorCode.DUEL_WINNER_NOT_PARTICIPANT,
          '승자는 결투 참가자여야 합니다.',
        ),
      );
    }

    const resolved = await this.resolveDuel(duel, winnerId);
    // 여기부터는 점수·원장·페널티가 이미 커밋된 뒤다 — 락 해제 실패로 예외를 올리면
    // 안 된다(releasePairLockQuietly 주석).
    await this.releasePairLockQuietly(duel);
    // 확정 직전에 정리 잡이 ACCEPTED->VOID를 선점했을 수 있다. 그 경우 COMPLETED가
    // 아니므로 승자 없는 결과를 confirmed로 알리지 않고 무효로 매핑한다.
    return resolved.status === DuelStatus.COMPLETED
      ? { status: 'confirmed', duel: resolved }
      : { status: 'void', duel: resolved };
  }

  /**
   * 승패를 가리지 못한 결투를 무효 처리한다 (재경기까지 갔는데도 동점, 양쪽 모두 미제출 등).
   * 점수 변동도 페널티도 없다.
   */
  async voidByGame(duelId: number): Promise<Duel | null> {
    const duel = await this.duelRepo.findOne({ where: { id: duelId } });
    if (!duel) return null;

    const updated = await this.duelRepo
      .createQueryBuilder()
      .update(Duel)
      .set({
        status: DuelStatus.VOID,
        completedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where('id = :id AND status = :accepted', {
        id: duelId,
        accepted: DuelStatus.ACCEPTED,
      })
      .execute();

    // VOID가 이미 커밋된 뒤다 — finishByGame과 같은 이유로 락 해제는 조용히 처리한다.
    await this.releasePairLockQuietly(duel);
    // 이미 다른 경로(스윕 등)가 상태를 옮겼다면 그쪽이 커밋한 현재 상태를 그대로 돌려준다.
    if (updated.affected === 0) {
      return this.duelRepo.findOne({ where: { id: duelId } });
    }

    duel.status = DuelStatus.VOID;
    duel.completedAt = new Date(); // 실제 값은 DB CURRENT_TIMESTAMP — 반환 객체용 근사치
    return duel;
  }

  /**
   * 결투가 종료 상태로 **커밋된 뒤**의 페어 락 해제. 실패해도 예외를 올리지 않는다.
   *
   * 이 지점 이후로 예외가 나가면 MinigameService.settle의 catch가 결과를 삼키고,
   * 재시도는 getAcceptedDuel에서 COMPLETED/VOID를 보고 null로 접는다. 스윕은
   * PENDING/ACCEPTED만 건드리므로 아무도 duel:completed·duel:voided를 보내지 못하고,
   * 점수·페널티만 움직인 채 두 클라이언트가 게임 화면에 갇힌다 — MinigameService.decide가
   * cleanupSession을 삼키는 것과 정확히 같은 이유다.
   *
   * 놓친 락은 DUEL_ACTIVE_TTL로 자연 회수되고, 탈퇴 경로의 purgeUserKeys도 걷어간다.
   */
  private async releasePairLockQuietly(duel: Duel): Promise<void> {
    try {
      await this.redis.releaseLock(
        this.lockKey(duel.challengerId, duel.opponentId),
        String(duel.id),
      );
    } catch (err) {
      this.logger.warn(
        `결투 페어 락 해제 실패 duelId=${duel.id} (TTL로 회수됨): ${(err as Error).message}`,
      );
    }
  }

  /**
   * 상태 확정과 부수효과의 원자성:
   * - 아군 보너스 판정(Redis 읽기)은 어떤 커밋보다 먼저 수행한다 — 여기서 실패하면 결투가
   *   ACCEPTED로 남고 신고 스탬프가 신선해 스윕도 유예되므로, 재시도(합의는 멱등)로 복구된다
   * - 페널티(Redis)는 ClaimsService.visit()과 같은 순서로 DB 커밋 전에 걸고, 커밋 실패 시
   *   이번 호출이 새로 만든 것일 때만 롤백한다
   * - ACCEPTED -> COMPLETED CAS("처리할 권리"의 단일 획득)와 승패·점수 기록, 양측 점수 반영을
   *   한 트랜잭션으로 묶어, COMPLETED로 고정된 row에 winnerId/scoreDelta가 null로 남거나
   *   점수가 부분 반영된 채 복구 불능이 되는 일이 없게 한다 (전부 커밋 또는 전부 롤백)
   *
   * 크래시/재시도로 동일 결투에 대해 이 메서드가 두 번 호출되어도 두 번째 호출은
   * affected=0을 보고 그대로 반환하므로 점수가 중복 반영되지 않는다.
   */
  private async resolveDuel(duel: Duel, winnerId: string): Promise<Duel> {
    const loserId =
      winnerId === duel.challengerId ? duel.opponentId : duel.challengerId;

    const allyBonus = await this.hasAllyBonus(winnerId);
    const scoreDelta = Math.round(
      BASE_DUEL_SCORE * (allyBonus ? ALLY_BONUS_MULTIPLIER : 1),
    );

    // 원장에 남길 이벤트 시점의 팀. CAS와 같은 트랜잭션에서 append해야 하므로 미리 읽어둔다.
    // 탈퇴 등으로 유저 row가 사라졌으면 applyScoreDelta도 no-op이 되므로 원장 행도 남기지 않는다.
    // 이 조회와 insert 사이에 참가자가 사라지는 경우는 트랜잭션 안에서 SAVEPOINT로 처리한다.
    const teamByUserId = new Map(
      (await this.usersService.findByIds([winnerId, loserId])).map((u) => [
        u.id,
        u.team,
      ]),
    );

    const penalty = await this.redis.setPenalty(loserId, PENALTY_TTL);

    let claimed: boolean;
    try {
      claimed = await this.dataSource.transaction(async (manager) => {
        const claimResult = await manager
          .createQueryBuilder()
          .update(Duel)
          .set({
            status: DuelStatus.COMPLETED,
            winnerId,
            loserId,
            scoreDelta,
            allyBonusApplied: allyBonus,
            completedAt: () => 'CURRENT_TIMESTAMP',
          })
          .where('id = :id AND status = :accepted', {
            id: duel.id,
            accepted: DuelStatus.ACCEPTED,
          })
          .execute();
        if (claimResult.affected === 0) return false;

        await this.usersService.applyScoreDelta(winnerId, scoreDelta, manager);
        await this.usersService.applyScoreDelta(loserId, -scoreDelta, manager);

        // 점수 원장에도 append한다 — 개인 랭킹(명예의 전당)은 users.score가 아니라
        // SUM(score_events.personalPoints)로 산출되므로, 여기서 기록하지 않으면 결투 점수가
        // /users/me의 score에는 반영되는데 개인 랭킹에서는 통째로 빠져 두 값이 어긋난다.
        // teamPoints는 항상 0 — 결투 점수는 팀 점수·구 집계에 절대 포함되지 않는다(기획 확정).
        // 원장에는 명목 증감을 그대로 남긴다. users.score는 GREATEST(0, ...)로 하한이 걸리므로
        // 0에서 더 깎인 유저는 두 값이 갈리는데, 원장은 감사 로그라 실제 판정을 보존한다.
        for (const [userId, points] of [
          [winnerId, scoreDelta],
          [loserId, -scoreDelta],
        ] as const) {
          const team = teamByUserId.get(userId);
          if (team === undefined) continue;

          // 위 팀 스냅샷은 트랜잭션 밖에서 읽은 값이라, 그 뒤에 참가자가 삭제되면 스킵 판정이
          // 낡아 사라진 유저의 uuid로 insert를 시도하게 된다 → FK 위반. Postgres는 실패한 문이
          // 트랜잭션 전체를 abort시키므로 catch만으로는 결투 확정까지 함께 날아간다. SAVEPOINT로
          // 이 insert만 되돌려, 사라진 참가자의 원장 행만 건너뛰고 나머지는 그대로 커밋한다.
          //
          // 이 insert에서 외부 상태에 달린 FK는 userId뿐이다 — duelId는 바로 위에서 이 트랜잭션이
          // 갱신한 행이라 반드시 존재하고 spotId는 넘기지 않는다. 그래서 23503을 "참가자가 사라짐"
          // 으로 읽어도 다른 원인을 삼키지 않는다.
          await manager.query('SAVEPOINT duel_ledger');
          try {
            await this.scoresService.record(manager, {
              userId,
              team,
              type:
                userId === winnerId
                  ? ScoreEventType.DUEL_WIN
                  : ScoreEventType.DUEL_LOSS,
              personalPoints: points,
              teamPoints: 0,
              duelId: duel.id,
            });
            await manager.query('RELEASE SAVEPOINT duel_ledger');
          } catch (err) {
            if (pgErrorCode(err) !== PG_FOREIGN_KEY_VIOLATION) throw err;
            await manager.query('ROLLBACK TO SAVEPOINT duel_ledger');
            this.logger.warn(
              `결투 원장 append 생략 — 참가자가 사라짐 duelId=${duel.id} userId=${userId}`,
            );
          }
        }
        return true;
      });
    } catch (err) {
      // 트랜잭션 실패 — 결투는 ACCEPTED로 남아 재시도 가능하므로, 미리 걸어둔 페널티만 되돌린다
      if (penalty.created) {
        await this.redis.clearPenalty(loserId).catch((redisErr) => {
          this.logger.error(
            `페널티 롤백 실패 duelId=${duel.id} loserId=${loserId}`,
            redisErr,
          );
        });
      }
      throw err;
    }

    if (!claimed) {
      this.logger.warn(
        `결투 이미 처리됨, 부수효과 재적용 생략 duelId=${duel.id}`,
      );
      const existing = await this.duelRepo.findOne({
        where: { id: duel.id },
      });
      // 선점한 처리가 COMPLETED를 커밋했다면 패자 페널티는 정당하므로 그대로 둔다
      // (이번 호출의 setPenalty는 만료/유실된 페널티의 복구가 된다). COMPLETED가
      // 아니라면(스윕 VOID 선점) 승패가 확정되지 않았으니 새로 만든 페널티를 되돌린다.
      if (existing?.status !== DuelStatus.COMPLETED && penalty.created) {
        await this.redis.clearPenalty(loserId).catch((redisErr) => {
          this.logger.error(
            `페널티 롤백 실패 duelId=${duel.id} loserId=${loserId}`,
            redisErr,
          );
        });
      }
      return existing ?? duel;
    }

    duel.status = DuelStatus.COMPLETED;
    duel.winnerId = winnerId;
    duel.loserId = loserId;
    duel.scoreDelta = scoreDelta;
    duel.allyBonusApplied = allyBonus;
    duel.completedAt = new Date(); // 실제 값은 DB CURRENT_TIMESTAMP — 반환 객체용 근사치
    return duel;
  }

  /**
   * 탈퇴하는 유저가 참가 중인 결투를 종료한다. **users 행을 지우는 트랜잭션 안에서**
   * 호출해야 한다(manager를 넘기는 이유).
   *
   * FK가 SET NULL이라 유저 삭제 자체는 성공하지만, PENDING/ACCEPTED 행을 그대로 두면
   * 참가자 한쪽만 NULL인 채 status가 살아남아 남는 상대가 두 가지 피해를 본다.
   * 1) requestDuel의 hasActiveDuel 체크가 이 행을 여전히 활성으로 세어, 상대는 스윕이
   *    정리할 때까지 새 결투를 아예 신청하지 못한다.
   * 2) respondDuel·resolveDuel은 lockKey(challengerId, opponentId)를 그때그때 다시
   *    계산하는데, 한쪽이 NULL이면 신청 시점에 실제로 잡았던 키와 다른 키가 나온다.
   *    엉뚱한 키를 extend/release하고 진짜 락은 TTL까지 남는다.
   *
   * 전이는 스윕과 같게 맞춘다 — PENDING은 EXPIRED(응답을 못 받은 신청), ACCEPTED는
   * VOID(결과가 확정되지 못한 대전).
   *
   * requestDuel과 같은 advisory lock을 잡아, 종료와 유저 삭제 사이에 이 유저를 상대로
   * 한 새 결투가 끼어들어 다시 고아 행이 되는 것을 막는다(트랜잭션 종료 시 자동 해제).
   *
   * Redis 락 해제와 알림은 커밋 뒤라야 하므로 여기서 하지 않는다 — 반환한 행을
   * settleTerminatedDuels에 넘긴다.
   */
  async terminateActiveDuelsFor(
    userId: string,
    manager: EntityManager,
  ): Promise<SweptDuelRow[]> {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`duel:user:${userId}`],
    );

    const mine = '("challengerId" = :userId OR "opponentId" = :userId)';

    const expired = await manager
      .createQueryBuilder()
      .update(Duel)
      .set({ status: DuelStatus.EXPIRED })
      .where(`${mine} AND status = :pending`, {
        userId,
        pending: DuelStatus.PENDING,
      })
      .returning('id, "challengerId", "opponentId"')
      .execute();

    const voided = await manager
      .createQueryBuilder()
      .update(Duel)
      .set({
        status: DuelStatus.VOID,
        completedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where(`${mine} AND status = :accepted`, {
        userId,
        accepted: DuelStatus.ACCEPTED,
      })
      .returning('id, "challengerId", "opponentId"')
      .execute();

    return [
      ...(expired.raw as SweptDuelRow[]).map((row) => ({
        ...row,
        event: 'duel:expired',
      })),
      ...(voided.raw as SweptDuelRow[]).map((row) => ({
        ...row,
        event: 'duel:voided',
      })),
    ];
  }

  /**
   * terminateActiveDuelsFor가 끝낸 결투의 뒷정리 — **커밋 후에** 호출한다. 롤백된
   * 트랜잭션의 결투를 종료됐다고 알리거나 살아 있는 락을 풀어버리면 안 된다.
   *
   * 알림은 남는 쪽에만 보낸다. 탈퇴자의 알림 큐는 어차피 purgeUserKeys가 지운다.
   * 실패해도 탈퇴를 되돌리지 않는다 — 결투는 DB에서 이미 종료됐고, 남은 락은 TTL로
   * 소멸하며 그마저도 purgeUserKeys의 `duel:lock:*` 정리가 걷어간다.
   */
  async settleTerminatedDuels(
    rows: SweptDuelRow[],
    leaverId: string,
  ): Promise<void> {
    if (rows.length === 0) return;

    // 락 토큰은 requestDuel과 같은 규칙(row id)이라, 소유자가 이 결투일 때만 CAS로 지운다.
    // 참가자가 이미 NULL인 행은 페어 키를 복원할 수 없으니 건너뛴다 — 그런 락은
    // purgeUserKeys의 `duel:lock:*` 정리나 TTL이 걷어간다.
    await Promise.all(
      rows.map((row) => {
        const { challengerId, opponentId } = row;
        if (!challengerId || !opponentId) return Promise.resolve();
        return this.redis
          .releaseLock(this.lockKey(challengerId, opponentId), String(row.id))
          .catch((err: Error) => {
            this.logger.warn(
              `탈퇴 결투 락 해제 실패 duelId=${row.id}: ${err.message}`,
            );
          });
      }),
    );

    for (const event of ['duel:expired', 'duel:voided']) {
      await this.notifySwept(
        rows.filter((row) => row.event === event),
        event,
        leaverId,
      );
    }
  }

  /**
   * 시간 기반 상태 전이를 강제할 durable한 백스톱 (주기 잡에서 호출).
   * - PENDING이 DUEL_REQUEST_TTL을 넘겨 방치됨 → EXPIRED
   *   (게이트웨이의 setTimeout은 프로세스 메모리라 서버 재시작 시 유실되고,
   *    requestDuel의 저장~락 획득 사이 크래시로 남은 고아 row도 여기서 함께 정리된다)
   * - ACCEPTED가 DUEL_ACTIVE_TTL을 넘겨 결과 미확정 → VOID
   *   (한쪽이 결과를 제출하지 않고 잠수해 패배를 회피하는 것을 차단)
   *
   * 각 컷오프는 해당 락 TTL + 여유(grace)보다 뒤이므로, 이 시점에 Redis 페어 락은 이미
   * 자연 만료되어 별도 락 해제가 필요 없다. 상태 전이는 respondDuel/resolveDuel과 동일한
   * 조건부 UPDATE라 진행 중인 정상 처리와 경합해도 한쪽만 반영된다.
   */
  async sweepStaleDuels(): Promise<{
    expiredPending: number;
    voidedAccepted: number;
  }> {
    // 컷오프는 DB 시계(now())로 계산한다. requestedAt은 @CreateDateColumn(DB now())으로
    // 기록되므로, 앱 서버와 DB의 타임존이 다르면(예: 로컬 KST 앱 + 컨테이너 UTC DB)
    // 앱에서 계산한 Date와 비교 시 수 시간이 어긋나 방금 만든 결투가 즉시 만료될 수 있다.
    // 게이트웨이 타이머(expireDuel)와 같은 페널티를 여기서도 적용한다 — 서버 재시작 등으로
    // 타이머가 유실된 신청만 이 경로로 오므로, 여기서 빠뜨리면 "재시작 중에 무시하면 공짜"가
    // 된다. 상태 전이와 차감은 한 트랜잭션이라 둘 중 하나만 반영되는 일이 없다.
    const expired = await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(Duel)
        .set({ status: DuelStatus.EXPIRED })
        .where(
          'status = :pending AND "requestedAt" < now() - make_interval(secs => :sec)',
          {
            pending: DuelStatus.PENDING,
            sec: DUEL_REQUEST_TTL + DUEL_SWEEP_GRACE,
          },
        )
        .returning('id, "challengerId", "opponentId"')
        .execute();

      const rows = result.raw as SweptDuelRow[];
      const charges = await this.buildNoResponseCharges(manager, rows);
      await this.chargeDuelPenalties(manager, charges);

      // RETURNING은 차감 전 스냅샷이라 scoreDelta가 비어 있다. 실제로 깎인 행에만
      // 채워 넣어야 알림 payload가 DB와 같은 얘기를 한다.
      const chargedPoints = new Map(charges.map((c) => [c.duelId, c.points]));
      for (const row of rows) {
        row.scoreDelta = chargedPoints.get(row.id) ?? null;
      }

      // 알림에는 RETURNING 행이, 집계에는 affected가 필요하다 (실제로는 같은 수지만
      // 둘의 의미가 다르므로 각각 그대로 쓴다).
      return { rows, affected: result.affected ?? 0, charges };
    });

    // 결과 신고가 진행 중인 결투(resultReportedAt이 신선함)는 VOID 대상에서 제외한다 —
    // 양측이 실제로 합의된 결과를 신고하는 도중 스윕이 먼저 VOID를 커밋해 결과가
    // 버려지는 것을 방지. 신고 후 합의가 끝내 안 되면(상대 미신고/Redis 키 만료)
    // 스탬프가 DUEL_RESULT_TTL + grace를 넘긴 뒤에야 VOID로 넘어간다.
    const voided = await this.duelRepo
      .createQueryBuilder()
      .update(Duel)
      .set({
        status: DuelStatus.VOID,
        completedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where(
        'status = :accepted AND "respondedAt" < now() - make_interval(secs => :sec)' +
          ' AND ("resultReportedAt" IS NULL OR "resultReportedAt" < now() - make_interval(secs => :resultSec))',
        {
          accepted: DuelStatus.ACCEPTED,
          sec: DUEL_ACTIVE_TTL + DUEL_SWEEP_GRACE,
          resultSec: DUEL_RESULT_TTL + DUEL_SWEEP_GRACE,
        },
      )
      .returning('id, "challengerId", "opponentId"')
      .execute();

    // 참가자에게 결과를 알린다 — 스윕된 결투는 인메모리 타이머·결과 핸들러를 타지 않아
    // 여기서 알리지 않으면 클라이언트가 응답 대기 상태에 영영 갇힌다.
    // 보호막은 커밋 뒤에 건다 — 롤백된 스윕의 유저를 보호해두면 안 된다.
    await this.grantShields(expired.charges.map((c) => c.userId));

    await this.notifySwept(expired.rows, 'duel:expired');
    await this.notifySwept(voided.raw as SweptDuelRow[], 'duel:voided');

    return {
      expiredPending: expired.affected,
      voidedAccepted: voided.affected ?? 0,
    };
  }

  private async notifySwept(
    rows: SweptDuelRow[],
    event: string,
    excludeUserId?: string,
  ): Promise<void> {
    if (!this.notifier || rows.length === 0) return;
    const results = await Promise.allSettled(
      rows.flatMap((row) => {
        // payload는 양쪽에 동일하게 보내고, 누가 깎였는지는 penalizedUserId로 알린다.
        // 수신자별로 payload를 가르지 않아야 큐잉된 알림을 재생할 때도 형태가 같다.
        const payload = duelPenaltyPayload(row);
        return (
          [row.challengerId, row.opponentId]
            // 이미 탈퇴한 참가자는 NULL로 들어온다 — 보낼 곳이 없다.
            .filter((id): id is string => id !== null && id !== excludeUserId)
            .map((id) => this.notifier!(id, event, payload))
        );
      }),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      this.logger.warn(`스윕 알림 ${failed}건 발송 실패 (event: ${event})`);
    }
  }

  /** 승자 기준 반경 100m 내 같은 팀 인원이 2명 이상(본인 제외)인지 확인 */
  private async hasAllyBonus(winnerId: string): Promise<boolean> {
    const [winnerMeta, winnerPos] = await Promise.all([
      this.redis.getUserMeta(winnerId),
      this.redis.geoPos(winnerId),
    ]);
    if (!winnerMeta || !winnerPos) return false;

    const candidateIds = (
      await this.redis.geoSearch(
        winnerPos.lat,
        winnerPos.lng,
        ENCOUNTER_RADIUS_M,
      )
    ).filter((id) => id !== winnerId);
    if (candidateIds.length < ALLY_BONUS_MIN_COUNT) return false;

    const metaEntries = await Promise.all(
      candidateIds.map(
        async (id) => [id, await this.redis.getUserMeta(id)] as const,
      ),
    );
    const allyIds = metaEntries
      .filter(([, meta]) => meta?.team === winnerMeta.team)
      .map(([id]) => id);
    if (allyIds.length < ALLY_BONUS_MIN_COUNT) return false;

    const positions = await this.redis.geoPosMany(allyIds);
    const candidates = allyIds
      .filter((id) => positions.has(id))
      .map((id) => ({ id, ...positions.get(id)! }));
    const verifiedIds = await this.verifyProximityBatch(
      winnerPos.lat,
      winnerPos.lng,
      candidates,
      ENCOUNTER_RADIUS_M,
    );
    return verifiedIds.size >= ALLY_BONUS_MIN_COUNT;
  }
}
