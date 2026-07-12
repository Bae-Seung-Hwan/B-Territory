import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Duel, DuelStatus } from './entities/duel.entity';
import { RedisService } from '../common/redis/redis.service';
import { UsersService } from '../users/users.service';
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

type SweptDuelRow = { id: number; challengerId: string; opponentId: string };

@Injectable()
export class DuelsService {
  private readonly logger = new Logger(DuelsService.name);

  constructor(
    @InjectRepository(Duel)
    private readonly duelRepo: Repository<Duel>,
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly usersService: UsersService,
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
      throw new BadRequestException('자기 자신에게 결투를 신청할 수 없습니다.');
    }

    const target = await this.usersService.findById(targetUserId);
    if (!target) throw new NotFoundException('상대 유저를 찾을 수 없습니다.');
    if (target.team === challenger.team) {
      throw new BadRequestException('같은 팀에게는 결투를 신청할 수 없습니다.');
    }

    if (await this.redis.hasPenalty(challenger.id)) {
      throw new ForbiddenException(
        '결투 페널티 중에는 결투를 신청할 수 없습니다.',
      );
    }
    if (await this.redis.hasPenalty(targetUserId)) {
      throw new ForbiddenException('상대가 결투 페널티 중입니다.');
    }

    // geo:users의 좌표는 유저가 끊긴 뒤에도 스윕 전까지 남아있을 수 있으므로,
    // TTL로 관리되는 메타(접속 중 유저만 존재)로 "현재 접속 중"인지 먼저 확인한다.
    const targetMeta = await this.redis.getUserMeta(targetUserId);
    if (!targetMeta) {
      throw new BadRequestException(
        '상대의 위치 정보를 확인할 수 없습니다. 상대가 접속 중인지 확인해주세요.',
      );
    }

    const inRange = await this.verifyProximity(challenger.id, targetUserId);
    if (!inRange) {
      throw new BadRequestException(
        `반경 ${ENCOUNTER_RADIUS_M}m 이내에 있어야 결투를 신청할 수 있습니다.`,
      );
    }

    // 유저 단위 배타성: 페어 락은 같은 두 유저 조합만 막으므로, 서로 다른 상대와의
    // 동시 결투는 여기서 차단한다. 체크~저장 사이의 레이스로 드물게 중복이 생겨도
    // 방치되면 sweepStaleDuels가 정리하므로 best-effort 체크로 충분하다.
    const participantIds = [challenger.id, targetUserId];
    const hasActiveDuel = await this.duelRepo.existsBy([
      { challengerId: In(participantIds), status: In(ACTIVE_STATUSES) },
      { opponentId: In(participantIds), status: In(ACTIVE_STATUSES) },
    ]);
    if (hasActiveDuel) {
      throw new ConflictException(
        '본인 또는 상대가 이미 진행 중인 결투가 있습니다.',
      );
    }

    // 락보다 DB row를 먼저 만들어, row의 id를 락의 소유권 토큰으로 사용한다.
    // (락 획득 실패 시 방금 만든 row만 지우면 되므로 롤백이 단순해진다)
    const duel = await this.duelRepo.save(
      this.duelRepo.create({
        challengerId: challenger.id,
        opponentId: targetUserId,
        status: DuelStatus.PENDING,
      }),
    );

    const acquired = await this.redis.tryAcquireLock(
      this.lockKey(challenger.id, targetUserId),
      DUEL_REQUEST_TTL,
      String(duel.id),
    );
    if (!acquired) {
      await this.duelRepo.delete(duel.id);
      throw new ConflictException('이미 진행 중인 결투 요청이 있습니다.');
    }

    return duel;
  }

  async respondDuel(
    duelId: number,
    responderId: string,
    accept: boolean,
  ): Promise<Duel> {
    const duel = await this.duelRepo.findOne({ where: { id: duelId } });
    if (!duel) throw new NotFoundException('결투를 찾을 수 없습니다.');
    if (duel.opponentId !== responderId) {
      throw new ForbiddenException(
        '본인에게 온 결투 요청만 응답할 수 있습니다.',
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
      throw new ConflictException('이미 처리된 결투입니다.');
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
    if (!duel) throw new NotFoundException('결투를 찾을 수 없습니다.');
    if (duel.status !== DuelStatus.ACCEPTED) {
      throw new ConflictException('수락된 결투만 결과를 제출할 수 있습니다.');
    }
    const participants = [duel.challengerId, duel.opponentId];
    if (!participants.includes(reporterId)) {
      throw new ForbiddenException('결투 참가자만 결과를 제출할 수 있습니다.');
    }
    if (!participants.includes(winnerId)) {
      throw new BadRequestException('승자는 결투 참가자여야 합니다.');
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
   * 점수/페널티 적용 전에 ACCEPTED -> COMPLETED로의 조건부 UPDATE를 먼저 커밋해 "처리할 권리"를
   * 단 한 번만 획득하도록 한다. 크래시/재시도로 동일 결투에 대해 이 메서드가 두 번 호출되어도
   * (Redis의 자가신고 합의는 멱등이라 재시도가 다시 'confirmed'를 반환할 수 있다) 두 번째 호출은
   * affected=0을 보고 그대로 반환하므로 점수가 중복 반영되지 않는다.
   */
  private async resolveDuel(duel: Duel, winnerId: string): Promise<Duel> {
    const loserId =
      winnerId === duel.challengerId ? duel.opponentId : duel.challengerId;

    const claimResult = await this.duelRepo
      .createQueryBuilder()
      .update(Duel)
      .set({ status: DuelStatus.COMPLETED, completedAt: new Date() })
      .where('id = :id AND status = :accepted', {
        id: duel.id,
        accepted: DuelStatus.ACCEPTED,
      })
      .execute();

    if (claimResult.affected === 0) {
      this.logger.warn(
        `결투 이미 처리됨, 부수효과 재적용 생략 duelId=${duel.id}`,
      );
      const existing = await this.duelRepo.findOne({
        where: { id: duel.id },
      });
      return existing ?? duel;
    }

    const allyBonus = await this.hasAllyBonus(winnerId);
    const scoreDelta = Math.round(
      BASE_DUEL_SCORE * (allyBonus ? ALLY_BONUS_MULTIPLIER : 1),
    );

    await Promise.all([
      this.usersService.applyScoreDelta(winnerId, scoreDelta),
      this.usersService.applyScoreDelta(loserId, -scoreDelta),
      this.redis.setPenalty(loserId, PENALTY_TTL),
    ]);

    duel.status = DuelStatus.COMPLETED;
    duel.winnerId = winnerId;
    duel.loserId = loserId;
    duel.scoreDelta = scoreDelta;
    duel.allyBonusApplied = allyBonus;
    duel.completedAt = new Date();
    return this.duelRepo.save(duel);
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

    const voided = await this.duelRepo
      .createQueryBuilder()
      .update(Duel)
      .set({
        status: DuelStatus.VOID,
        completedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where(
        'status = :accepted AND "respondedAt" < now() - make_interval(secs => :sec)',
        {
          accepted: DuelStatus.ACCEPTED,
          sec: DUEL_ACTIVE_TTL + DUEL_SWEEP_GRACE,
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
  ): Promise<void> {
    if (!this.notifier || rows.length === 0) return;
    const results = await Promise.allSettled(
      rows.flatMap((row) => [
        this.notifier!(row.challengerId, event, { duelId: row.id }),
        this.notifier!(row.opponentId, event, { duelId: row.id }),
      ]),
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
