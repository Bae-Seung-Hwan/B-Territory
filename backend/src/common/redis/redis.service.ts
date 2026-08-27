import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.client = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      db: this.config.get<number>('REDIS_DB', 0),
      // Redis에 도달하지 못할 때(닫힌 포트·네트워크 파티션 등) 명령이 예외로 전환되기까지
      // 걸리는 시간을 줄인다. ioredis 기본값은 20회(RedisOptions.js)이고 재시도 백오프가
      // min(times*50, 2000)ms라, 기본값이면 명령 하나가 예외가 되기까지 실측 12~24초가
      // 걸린다 — 그 사이 부팅은 app.listen()에 도달하지 못하고 요청은 그대로 매달린다.
      // 무한 대기는 아니지만 앱 전체가 응답 불가인 시간이 그만큼 길어진다.
      // retryStrategy는 기본값(계속 재접속)이라 Redis가 돌아오면 자동 회복된다.
      connectTimeout: 5000,
      maxRetriesPerRequest: 3,
    });
    this.client.on('error', (err) => {
      this.logger.error(`connection error: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  /** 연결 확인용 PING — 헬스체크가 Redis 도달 가능 여부를 판정하는 데 쓴다. */
  async ping(): Promise<string> {
    return this.client.ping();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  /** GET + TTL in a single pipeline to avoid TOCTOU between two calls */
  async getWithTtl(
    key: string,
  ): Promise<{ value: string | null; ttl: number }> {
    const [[, value], [, ttl]] = (await this.client
      .pipeline()
      .get(key)
      .ttl(key)
      .exec()) as [[null, string | null], [null, number]];
    return { value, ttl };
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /** 카운터 증가 후 새 값 반환. 캐시 무효화 버전 키에 쓴다(키가 없으면 0에서 시작). */
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  /**
   * "하루 1회" 게이트의 공용 구현 (SET NX — 확인과 기록을 단일 원자 연산으로 처리해
   * 동시 요청도 하나만 통과). created=false면 그 키가 오늘 이미 소진된 것이다.
   *
   * 이후 단계가 실패하면 호출측이 반환된 token으로 clearDailyGate를 호출해 이번
   * 요청이 만든 키만 CAS 롤백한다 — 자정 근처 최소 TTL(1초) 구간에서 이 요청이
   * 지연 실패하는 사이 자정을 넘겨 같은 키로 다음날 정상 사용이 이미 성사된
   * 경우, 무조건 DEL이면 그 새 키를 지워버리므로 tryAcquireLock/releaseLock과
   * 같은 토큰 기반 CAS로 막는다.
   *
   * 점령·미션이 같은 패턴을 각자 복제하고 있어(한쪽만 고쳐지는 사고 방지) 여기로 모았다.
   * 키 문자열은 도메인별 래퍼가 만든다 — 기존 키 포맷을 그대로 유지해야 한다.
   */
  private async markDailyGate(
    key: string,
    ttlSeconds: number,
  ): Promise<{ created: boolean; token: string }> {
    const token = randomUUID();
    const created = await this.tryAcquireLock(key, ttlSeconds, token);
    return { created, token };
  }

  private async clearDailyGate(key: string, token: string): Promise<void> {
    await this.releaseLock(key, token);
  }

  private dailyClaimKey(userId: string, spotId: number | '*'): string {
    return `claim:daily:${userId}:${spotId}`;
  }

  /** 유저별 관광지 일일 점령 게이트. created=false면 오늘(KST) 이미 점령한 관광지. */
  async markDailyClaim(
    userId: string,
    spotId: number,
    ttlSeconds: number,
  ): Promise<{ created: boolean; token: string }> {
    return this.markDailyGate(this.dailyClaimKey(userId, spotId), ttlSeconds);
  }

  async clearDailyClaim(
    userId: string,
    spotId: number,
    token: string,
  ): Promise<void> {
    await this.clearDailyGate(this.dailyClaimKey(userId, spotId), token);
  }

  // spotId에 '*'를 넘기면 purgeUserKeys가 쓰는 SCAN 패턴이 된다 — 키 포맷이
  // 두 곳으로 갈라져 한쪽만 바뀌는 사고를 막으려고 생성을 여기로 모았다.
  private missionDailyKey(
    mission: string,
    userId: string,
    spotId: number | '*',
  ): string {
    return `mission:${mission}:daily:${userId}:${spotId}`;
  }

  /** 미션(사진·리뷰) 일일 게이트 — 관광지별 인당 하루 1회. */
  async markMissionDaily(
    mission: string,
    userId: string,
    spotId: number,
    ttlSeconds: number,
  ): Promise<{ created: boolean; token: string }> {
    return this.markDailyGate(
      this.missionDailyKey(mission, userId, spotId),
      ttlSeconds,
    );
  }

  async clearMissionDaily(
    mission: string,
    userId: string,
    spotId: number,
    token: string,
  ): Promise<void> {
    await this.clearDailyGate(
      this.missionDailyKey(mission, userId, spotId),
      token,
    );
  }

  private missionVisitKey(userId: string, spotId: number | '*'): string {
    return `mission:visit:${userId}:${spotId}`;
  }

  /**
   * 방문 체크인 기록 — 현장 GPS(50m) 검증 통과 시 방문 창을 연다. 값에는 점수 가중치용
   * sigungucode(없으면 빈 문자열)를 담아, 창 유효기간 안의 사진·리뷰 제출이 재검증 없이
   * 재사용한다. 재체크인은 창을 새 TTL로 덮어써 갱신한다(단순 SET).
   */
  async markVisit(
    userId: string,
    spotId: number,
    sigungucode: string | null,
    ttlSeconds: number,
  ): Promise<void> {
    await this.set(
      this.missionVisitKey(userId, spotId),
      sigungucode ?? '',
      ttlSeconds,
    );
  }

  /**
   * 방문 창 조회 — null이면 미방문(체크인 필요)이고, 문자열이면 창이 유효하다(값은
   * 저장된 sigungucode, 빈 문자열은 좌표는 있으나 시군구코드 없음을 뜻함). 빈 문자열이
   * falsy이므로 존재 여부는 반드시 `=== null` 비교로 판정해야 한다.
   */
  async getVisit(userId: string, spotId: number): Promise<string | null> {
    return this.get(this.missionVisitKey(userId, spotId));
  }

  /**
   * 패턴에 맞는 키 일괄 삭제 (KEYS와 달리 SCAN 기반이라 서버를 블로킹하지 않음).
   * 더 이상 소유 코드가 없는 leftover 키 정리용. 삭제한 키 수를 반환한다.
   */
  async deleteByPattern(pattern: string): Promise<number> {
    let cursor = '0';
    let deleted = 0;
    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) deleted += await this.client.unlink(...keys);
    } while (cursor !== '0');
    return deleted;
  }

  /**
   * 방어 타이머 원자 연산 (Lua 스크립트)
   * - 키 없음: 타이머 신규 설정 후 'ok' (created: true)
   * - 같은 팀:  타이머 리셋 없이 'ok' (무한 리셋 방지, created: false)
   * - 다른 팀:  'blocked' + 현재 방어팀 + 남은 초
   * created는 실패 시 롤백에서 신규 키만 지우기 위한 구분값
   */
  async claimDefense(
    key: string,
    team: string,
    ttl: number,
  ): Promise<
    | { status: 'ok'; remaining: number; created: boolean }
    | { status: 'blocked'; defenseTeam: string; remaining: number }
  > {
    const lua = `
      local v = redis.call('GET', KEYS[1])
      if v == false then
        redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
        return {'ok', tonumber(ARGV[2]), 1}
      elseif v == ARGV[1] then
        local remaining = redis.call('TTL', KEYS[1])
        return {'ok', remaining, 0}
      else
        local remaining = redis.call('TTL', KEYS[1])
        return {'blocked', v, remaining}
      end
    `;
    const result = (await this.client.eval(lua, 1, key, team, String(ttl))) as (
      | string
      | number
    )[];
    if (result[0] === 'ok')
      return {
        status: 'ok',
        remaining: Number(result[1]),
        created: result[2] === 1,
      };
    return {
      status: 'blocked',
      defenseTeam: result[1] as string,
      remaining: Number(result[2]),
    };
  }

  /**
   * 고정 윈도우 레이트리밋 — windowSeconds 동안 limit회까지 허용. 허용되면 true.
   * INCR + (첫 요청에만) EXPIRE를 Lua로 원자 실행해, EXPIRE 누락으로 키가 영구히
   * 남는 경합을 막는다. 채팅/위치 릴레이 도배 방지용.
   */
  async consumeRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const lua = `
      local c = redis.call('INCR', KEYS[1])
      if c == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
      return c
    `;
    const count = (await this.client.eval(
      lua,
      1,
      key,
      String(windowSeconds),
    )) as number;
    return count <= limit;
  }

  private static readonly GEO_KEY = 'geo:users';
  // GEO 멤버 자체는 개별 TTL을 가질 수 없어, 정리를 위해 마지막 갱신 시각을 별도 ZSET에 기록해둔다.
  private static readonly LASTSEEN_KEY = 'geo:lastseen';
  private static readonly META_TTL = 120; // 위치 미갱신 시 자동 소멸 (초)

  private metaKey(userId: string): string {
    return `user:meta:${userId}`;
  }

  /** 유저 최신 좌표 등록 + 팀/소켓 메타 갱신 (메타는 TTL로 자동 소멸, geo:users는 pruneStaleGeo로 정리) */
  async geoAdd(
    userId: string,
    lat: number,
    lng: number,
    team: string,
    socketId: string,
  ): Promise<void> {
    await this.client
      .pipeline()
      .geoadd(RedisService.GEO_KEY, lng, lat, userId)
      .zadd(RedisService.LASTSEEN_KEY, Date.now(), userId)
      .hset(this.metaKey(userId), { team, socketId })
      .expire(this.metaKey(userId), RedisService.META_TTL)
      .exec();
  }

  async geoRemove(userId: string): Promise<void> {
    await this.client
      .pipeline()
      .zrem(RedisService.GEO_KEY, userId)
      .zrem(RedisService.LASTSEEN_KEY, userId)
      .del(this.metaKey(userId))
      .exec();
  }

  async getUserMeta(
    userId: string,
  ): Promise<{ team: string; socketId: string } | null> {
    const meta = await this.client.hgetall(this.metaKey(userId));
    if (!meta.team || !meta.socketId) return null;
    return { team: meta.team, socketId: meta.socketId };
  }

  /**
   * maxAgeSeconds보다 오래 갱신되지 않은 유저를 geo:users/geo:lastseen에서 제거한다.
   * 비정상 종료(handleDisconnect 미호출) 등으로 남은 유령 좌표를 정리하기 위한 주기적 스윕용.
   */
  async pruneStaleGeo(maxAgeSeconds: number): Promise<number> {
    const cutoff = Date.now() - maxAgeSeconds * 1000;
    const staleIds = await this.client.zrangebyscore(
      RedisService.LASTSEEN_KEY,
      '-inf',
      cutoff,
    );
    if (staleIds.length === 0) return 0;
    await this.client
      .pipeline()
      .zrem(RedisService.GEO_KEY, ...staleIds)
      .zrem(RedisService.LASTSEEN_KEY, ...staleIds)
      .exec();
    return staleIds.length;
  }

  /** 반경(m) 내 후보 유저 id 목록 (본인 포함 여부는 호출부에서 필터) */
  async geoSearch(
    lat: number,
    lng: number,
    radiusM: number,
  ): Promise<string[]> {
    const members = (await this.client.geosearch(
      RedisService.GEO_KEY,
      'FROMLONLAT',
      lng,
      lat,
      'BYRADIUS',
      radiusM,
      'm',
      'ASC',
    )) as string[];
    return members;
  }

  async geoPos(userId: string): Promise<{ lat: number; lng: number } | null> {
    const [pos] = await this.client.geopos(RedisService.GEO_KEY, userId);
    if (!pos) return null;
    return { lng: Number(pos[0]), lat: Number(pos[1]) };
  }

  async geoPosMany(
    userIds: string[],
  ): Promise<Map<string, { lat: number; lng: number }>> {
    const map = new Map<string, { lat: number; lng: number }>();
    if (userIds.length === 0) return map;
    const positions = await this.client.geopos(
      RedisService.GEO_KEY,
      ...userIds,
    );
    userIds.forEach((id, i) => {
      const pos = positions[i];
      if (pos) map.set(id, { lng: Number(pos[0]), lat: Number(pos[1]) });
    });
    return map;
  }

  /**
   * SET NX EX 기반 1회성 락 (조우 알림 쿨다운, 결투 중복 방지 등에 공용 사용).
   * token을 지정하면 releaseLock/extendLock에서 소유권(CAS) 검증에 쓸 수 있다.
   */
  async tryAcquireLock(
    key: string,
    ttlSeconds: number,
    token: string = '1',
  ): Promise<boolean> {
    const result = await this.client.set(key, token, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /**
   * token을 주면 현재 값이 token과 일치할 때만 삭제(CAS) — 이미 만료되고 다른 소유자가
   * 새로 잡은 락을 실수로 지우는 것을 방지한다. token을 생략하면 무조건 삭제(레거시 동작).
   */
  async releaseLock(key: string, token?: string): Promise<void> {
    if (token === undefined) {
      await this.client.del(key);
      return;
    }
    const lua = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
    `;
    await this.client.eval(lua, 1, key, token);
  }

  /** 현재 값이 token과 일치할 때만 TTL을 연장(CAS) — 소유자가 아니면 조용히 무시(false 반환) */
  async extendLock(
    key: string,
    ttlSeconds: number,
    token: string,
  ): Promise<boolean> {
    const lua = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
      end
      return 0
    `;
    const result = await this.client.eval(
      lua,
      1,
      key,
      token,
      String(ttlSeconds),
    );
    return Number(result) === 1;
  }

  /**
   * created=true면 이번 호출로 새로 생성된 페널티(기존 키 없음) — 호출측이 후속 커밋 실패 시
   * 자신이 만든 페널티만 롤백할 수 있도록 구분한다 (claimDefense의 created와 같은 용도).
   * 기존 페널티가 있으면 TTL만 새로 부여한다.
   */
  async setPenalty(
    userId: string,
    ttlSeconds: number,
  ): Promise<{ created: boolean }> {
    const lua = `
      local created = redis.call('SET', KEYS[1], '1', 'EX', tonumber(ARGV[1]), 'NX')
      if created then return 1 end
      redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
      return 0
    `;
    const result = await this.client.eval(
      lua,
      1,
      `penalty:${userId}`,
      String(ttlSeconds),
    );
    return { created: Number(result) === 1 };
  }

  async clearPenalty(userId: string): Promise<void> {
    await this.client.del(`penalty:${userId}`);
  }

  private duelShieldKey(userId: string): string {
    return `duel:shield:${userId}`;
  }

  /**
   * 결투 거절 보호막 — 이 키가 살아 있는 동안 이 유저에게는 결투를 걸 수 없다.
   *
   * 페널티(penalty:*)와 방향이 반대다. 페널티는 "너는 결투를 못 한다"이고 보호막은
   * "남이 너에게 결투를 못 건다"라, 보호막 중에도 본인은 얼마든지 신청할 수 있다.
   * 다만 신청하는 순간 clearDuelShield로 걷힌다(duels.service#requestDuel).
   *
   * 거절할 때마다 TTL을 새로 덮어쓴다 — 연속 거절이 보호 기간을 연장하는 건 의도된
   * 동작이다. 그 대가로 거절마다 점수가 깎이므로 무한정 숨어 있을 수는 없다.
   */
  async setDuelShield(userId: string, ttlSeconds: number): Promise<void> {
    await this.client.set(
      this.duelShieldKey(userId),
      '1',
      'EX',
      Math.max(1, Math.floor(ttlSeconds)),
    );
  }

  /** 남은 보호 시간(초). 보호막이 없으면 0 — 호출측이 남은 시간을 안내 문구에 쓴다. */
  async getDuelShieldTtl(userId: string): Promise<number> {
    // TTL은 키가 없으면 -2, TTL이 없으면 -1을 준다. setDuelShield는 항상 EX를 걸므로
    // 음수는 전부 "보호막 없음"으로 접는다.
    const ttl = await this.client.ttl(this.duelShieldKey(userId));
    return ttl > 0 ? ttl : 0;
  }

  /** 보호막 해제. 실제로 걷어낸 경우에만 true (호출측이 로그·알림 여부를 가른다). */
  async clearDuelShield(userId: string): Promise<boolean> {
    return (await this.client.del(this.duelShieldKey(userId))) > 0;
  }

  /**
   * 탈퇴 시 해당 유저의 Redis 흔적을 모두 지운다.
   *
   * 전부 TTL이 걸려 있어 언젠가는 사라지지만, 탈퇴는 "지금 지운다"가 요구사항이라
   * 명시적으로 정리한다. 특히 geo:users에 좌표가 남아 있으면 탈퇴한 유저가 다른
   * 이용자의 결투 탐지 결과에 계속 잡힌다.
   *
   * 실패해도 탈퇴 자체를 되돌리지 않는다 — DB에서 계정이 사라진 뒤라 남은 키는
   * 참조할 대상이 없고, 전부 TTL로 소멸한다. 호출측이 로그만 남긴다.
   */
  async purgeUserKeys(userId: string): Promise<void> {
    // 서로 건드리는 키가 겹치지 않아 순서에 의미가 없다 — 병렬로 보낸다.
    await Promise.all([
      this.geoRemove(userId),
      this.client
        .pipeline()
        .del(`penalty:${userId}`)
        .del(this.duelShieldKey(userId))
        .del(this.notifyKey(userId))
        .del(`report:rate:${userId}`)
        // "나를 차단한 사람" 캐시와 그 버전 키(moderation.service).
        .del(`chat:blockedby:${userId}`)
        .del(`chat:blockedbyver:${userId}`)
        .exec(),
      // 채팅 레이트리밋은 종류(message·location)별로 키가 갈린다.
      this.deleteByPattern(`chat:rate:*:${userId}`),
      // 일일 점령·미션 게이트는 스팟별로 흩어져 있어 패턴으로 지운다.
      this.deleteByPattern(this.dailyClaimKey(userId, '*')),
      this.deleteByPattern(this.missionVisitKey(userId, '*')),
      // 미션 종류(photo·review)마다 키가 갈려 mission 자리도 와일드카드로 둔다.
      this.deleteByPattern(this.missionDailyKey('*', userId, '*')),
      // 아래 둘은 두 유저 id를 정렬해 만든 쌍 키라 어느 자리에 오는지 알 수 없다.
      this.deleteByPattern(`encounter:cooldown:*${userId}*`),
      // 결투 락은 종료 처리(terminateActiveDuelsFor)에서 이미 풀리지만, 저장~락 획득
      // 사이 크래시로 남은 고아 락은 그 경로를 타지 않아 여기서 함께 걷어낸다.
      this.deleteByPattern(`duel:lock:*${userId}*`),
    ]);
  }

  async hasPenalty(userId: string): Promise<boolean> {
    const value = await this.client.get(`penalty:${userId}`);
    return value !== null;
  }

  /**
   * 결투 미니게임 라운드 점수 제출 (Lua 원자 연산).
   *
   * HSETNX라 같은 라운드에 두 번 제출해도 첫 값만 남는다 — 재전송으로 점수를 덮어써
   * 유리한 값으로 바꾸는 것을 막는다. 이미 제출한 유저면 status='duplicate'.
   *
   * 상대 점수는 어떤 경우에도 반환하지 않는다. 정산에 필요한 값은 호출측이
   * claimRoundSettlement으로 따로 읽는다 — 그래야 락을 쥔 쪽만 점수를 보게 된다.
   */
  async submitGameScore(
    duelId: number,
    round: number,
    userId: string,
    entry: string,
    ttlSeconds: number,
  ): Promise<{ status: 'duplicate' | 'waiting' | 'both' }> {
    const lua = `
      if redis.call('HSETNX', KEYS[1], ARGV[1], ARGV[2]) == 0 then
        return 'duplicate'
      end
      redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
      if redis.call('HLEN', KEYS[1]) < 2 then
        return 'waiting'
      end
      return 'both'
    `;
    const status = (await this.client.eval(
      lua,
      1,
      this.gameScoreKey(duelId, round),
      userId,
      entry,
      String(ttlSeconds),
    )) as 'duplicate' | 'waiting' | 'both';
    return { status };
  }

  /**
   * 라운드 정산 권리를 선점하면서 그 시점의 점수를 함께 읽는다 (Lua 원자 연산).
   *
   * 두 동작이 반드시 한 연산이어야 한다 — 락을 잡고 나서 따로 읽으면, 그 사이에 들어온
   * 제출이 스냅샷에서 빠져 제때 낸 참가자가 기권패로 처리된다. Redis는 명령을 단일
   * 스레드로 직렬화하므로, 여기서 안 읽힌 제출은 정산 시점 이후에 도착한 것이 확실하다.
   *
   * claimed=false면 다른 쪽(마감 타이머 또는 마지막 제출자)이 이미 정산 중이다.
   */
  async claimRoundSettlement(
    duelId: number,
    round: number,
    ttlSeconds: number,
  ): Promise<
    { claimed: false } | { claimed: true; entries: Map<string, string> }
  > {
    const lua = `
      if not redis.call('SET', KEYS[1], '1', 'EX', tonumber(ARGV[1]), 'NX') then
        return {'taken'}
      end
      local all = redis.call('HGETALL', KEYS[2])
      table.insert(all, 1, 'claimed')
      return all
    `;
    const result = (await this.client.eval(
      lua,
      2,
      this.settleKey(duelId, round),
      this.gameScoreKey(duelId, round),
      String(ttlSeconds),
    )) as string[];

    if (result[0] === 'taken') return { claimed: false };
    const entries = new Map<string, string>();
    for (let i = 1; i < result.length; i += 2) {
      entries.set(result[i], result[i + 1]);
    }
    return { claimed: true, entries };
  }

  /**
   * 정산 권리를 되돌린다 — 정산 도중 실패해 결과를 내지 못했을 때만 호출한다.
   * 이걸 안 하면 그 라운드는 TTL이 끝날 때까지 아무도 정산하지 못해, 클라이언트가
   * 결과를 못 받고 결투 스윕(수백 초 뒤)까지 매달린다.
   */
  async releaseRoundSettlement(duelId: number, round: number): Promise<void> {
    await this.client.del(this.settleKey(duelId, round));
  }

  private gameScoreKey(duelId: number, round: number): string {
    return `duel:game:${duelId}:r${round}`;
  }

  private settleKey(duelId: number, round: number): string {
    return `duel:game:${duelId}:settled:r${round}`;
  }

  private static readonly NOTIFICATION_MAX = 50;

  private notifyKey(userId: string): string {
    return `notify:${userId}`;
  }

  /**
   * 대상 유저의 소켓이 현재 이 프로세스에서 확인되지 않을 때(메타 TTL 만료, 순간적 재접속 등)
   * 이벤트를 잃어버리지 않도록 큐에 쌓아둔다. handleConnection에서 drainNotifications로 재생한다.
   */
  async queueNotification(
    userId: string,
    event: string,
    payload: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    const key = this.notifyKey(userId);
    const entry = JSON.stringify({ event, payload });
    await this.client
      .pipeline()
      .rpush(key, entry)
      .ltrim(key, -RedisService.NOTIFICATION_MAX, -1)
      .expire(key, ttlSeconds)
      .exec();
  }

  /**
   * 큐에 쌓인 알림을 원자적으로(MULTI) 읽고 비운다 — 드레인 도중 새로 들어온 알림을 잃지 않는다.
   *
   * 파싱은 엔트리별로 격리한다. 이 읽기는 파괴적이라(lrange + del이 먼저 확정된다) 손상된
   * 엔트리 하나에서 throw하면 이미 삭제된 나머지 정상 알림까지 통째로 날아가고, 큐가 비어
   * 있으므로 재접속해도 복구할 방법이 없다. 깨진 것만 버리고 나머지는 살려서 내보낸다.
   */
  async drainNotifications(
    userId: string,
  ): Promise<{ event: string; payload: unknown }[]> {
    const key = this.notifyKey(userId);
    const results = await this.client
      .multi()
      .lrange(key, 0, -1)
      .del(key)
      .exec();
    const entries = (results?.[0]?.[1] as string[] | undefined) ?? [];

    const parsed: { event: string; payload: unknown }[] = [];
    for (const raw of entries) {
      try {
        parsed.push(JSON.parse(raw) as { event: string; payload: unknown });
      } catch {
        this.logger.warn(`손상된 알림 엔트리 폐기 (userId=${userId})`);
      }
    }
    return parsed;
  }
}
