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

export type DuelResultOutcome =
  | { status: 'waiting' }
  | { status: 'conflict'; duel: Duel }
  | { status: 'confirmed'; duel: Duel };

/** 게이트웨이가 주입하는 알림 콜백 (온라인이면 즉시 emit, 아니면 Redis 큐잉) */
export type DuelNotifier = (
  userId: string,
  event: string,
  payload: unknown,
) => Promise<void>;

const ACTIVE_STATUSES = [DuelStatus.PENDING, DuelStatus.ACCEPTED];

type SweptDuelRow = {
  id: number;
  challengerId: string;
  opponentId: string;
  // 탈퇴 종료 경로에서만 채운다 — EXPIRED/VOID를 한 배열로 넘기고 알림 때 다시 가른다.
  event?: string;
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
    const duel = await this.dataSource.transaction(async (manager) => {
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

    // PENDING일 때만 전이하는 조건부 UPDATE로 accept/reject/expire 동시 요청 경쟁을 DB 레벨에서 막는다.
    const newStatus = accept ? DuelStatus.ACCEPTED : DuelStatus.REJECTED;
    const updateResult = await this.duelRepo
      .createQueryBuilder()
      .update(Duel)
      // respondedAt은 DB 시계로 기록한다 — requestedAt(@CreateDateColumn, DB now())과
      // sweepStaleDuels의 컷오프(DB now() 기준)가 같은 시계를 쓰도록 통일 (앱-DB 타임존 차이 방어)
      .set({ status: newStatus, respondedAt: () => 'CURRENT_TIMESTAMP' })
      .where('id = :id AND status = :pending', {
        id: duelId,
        pending: DuelStatus.PENDING,
      })
      .execute();
    if (updateResult.affected === 0) {
      throw new ConflictException(
        errBody(ErrorCode.DUEL_ALREADY_HANDLED, '이미 처리된 결투입니다.'),
      );
    }

    const lockKey = this.lockKey(duel.challengerId, duel.opponentId);
    const token = String(duel.id);
    if (accept) {
      const extended = await this.redis.extendLock(
        lockKey,
        DUEL_ACTIVE_TTL,
        token,
      );
      if (!extended) {
        this.logger.warn(`결투 락 연장 실패 duelId=${duelId} (이미 만료됨)`);
      }
    } else {
      await this.redis.releaseLock(lockKey, token);
    }

    duel.status = newStatus;
    duel.respondedAt = new Date(); // 실제 값은 DB CURRENT_TIMESTAMP — 반환 객체용 근사치
    return duel;
  }

  /** PENDING 상태로 DUEL_REQUEST_TTL이 지나도 응답 없으면 게이트웨이 타이머가 호출 */
  async expireDuel(duelId: number): Promise<Duel | null> {
    const duel = await this.duelRepo.findOne({ where: { id: duelId } });
    if (!duel) return null;

    // respondDuel과 동일하게 조건부 UPDATE로 처리해, accept가 동시에 들어와도 둘 중 하나만 반영된다.
    const updateResult = await this.duelRepo
      .createQueryBuilder()
      .update(Duel)
      .set({ status: DuelStatus.EXPIRED })
      .where('id = :id AND status = :pending', {
        id: duelId,
        pending: DuelStatus.PENDING,
      })
      .execute();
    if (updateResult.affected === 0) return null;

    await this.redis.releaseLock(
      this.lockKey(duel.challengerId, duel.opponentId),
      String(duel.id),
    );
    duel.status = DuelStatus.EXPIRED;
    return duel;
  }

  async submitResult(
    duelId: number,
    reporterId: string,
    winnerId: string,
  ): Promise<DuelResultOutcome> {
    const duel = await this.duelRepo.findOne({ where: { id: duelId } });
    if (!duel)
      throw new NotFoundException(
        errBody(ErrorCode.DUEL_NOT_FOUND, '결투를 찾을 수 없습니다.'),
      );
    if (duel.status !== DuelStatus.ACCEPTED) {
      throw new ConflictException(
        errBody(
          ErrorCode.DUEL_NOT_ACCEPTED,
          '수락된 결투만 결과를 제출할 수 있습니다.',
        ),
      );
    }
    const participants = [duel.challengerId, duel.opponentId];
    if (!participants.includes(reporterId)) {
      throw new ForbiddenException(
        errBody(
          ErrorCode.DUEL_NOT_PARTICIPANT,
          '결투 참가자만 결과를 제출할 수 있습니다.',
        ),
      );
    }
    if (!participants.includes(winnerId)) {
      throw new BadRequestException(
        errBody(
          ErrorCode.DUEL_WINNER_NOT_PARTICIPANT,
          '승자는 결투 참가자여야 합니다.',
        ),
      );
    }

    // 신고 접수 시각을 DB 시계로 스탬프하는 조건부 UPDATE — 두 역할을 겸한다:
    // 1) sweepStaleDuels가 이 스탬프가 신선한 동안 VOID를 유예하므로, 양측이 실제로
    //    신고를 진행 중인 결투가 타이밍상 스윕에 선점되어 결과가 버려지지 않는다
    // 2) 스윕이 이미 VOID를 커밋한 뒤라면 affected=0으로 즉시 거부되어, 신고가
    //    Redis에만 기록된 채 유실되는 일이 없다 (위의 status 확인과 달리 원자적)
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
          '수락된 결투만 결과를 제출할 수 있습니다.',
        ),
      );
    }

    const result = await this.redis.submitDuelResult(
      duelId,
      reporterId,
      winnerId,
      DUEL_RESULT_TTL,
    );
    if (result.status === 'waiting') return { status: 'waiting' };

    const lock = this.lockKey(duel.challengerId, duel.opponentId);
    const token = String(duel.id);
    if (result.status === 'conflict') {
      duel.status = DuelStatus.VOID;
      duel.completedAt = new Date();
      await this.duelRepo.save(duel);
      await this.redis.releaseLock(lock, token);
      return { status: 'conflict', duel };
    }

    const resolved = await this.resolveDuel(duel, result.winnerId);
    await this.redis.releaseLock(lock, token);
    // 상태 확인~resolveDuel 사이에 정리 잡이 ACCEPTED→VOID를 선점했을 수 있다.
    // 그 경우 COMPLETED가 아니므로 승자 없는 결과를 'confirmed'로 알리지 않고 무효로 매핑한다.
    if (resolved.status !== DuelStatus.COMPLETED) {
      return { status: 'conflict', duel: resolved };
    }
    return { status: 'confirmed', duel: resolved };
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
    await Promise.all(
      rows.map((row) =>
        this.redis
          .releaseLock(
            this.lockKey(row.challengerId, row.opponentId),
            String(row.id),
          )
          .catch((err: Error) => {
            this.logger.warn(
              `탈퇴 결투 락 해제 실패 duelId=${row.id}: ${err.message}`,
            );
          }),
      ),
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
    const expired = await this.duelRepo
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
    await this.notifySwept(expired.raw as SweptDuelRow[], 'duel:expired');
    await this.notifySwept(voided.raw as SweptDuelRow[], 'duel:voided');

    return {
      expiredPending: expired.affected ?? 0,
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
      rows.flatMap((row) =>
        [row.challengerId, row.opponentId]
          .filter((id) => id !== excludeUserId)
          .map((id) => this.notifier!(id, event, { duelId: row.id })),
      ),
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
