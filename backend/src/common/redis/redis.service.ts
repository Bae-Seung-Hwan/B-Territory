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

  private dailyClaimKey(userId: string, spotId: number): string {
    return `claim:daily:${userId}:${spotId}`;
  }

  /**
   * 유저별 관광지 일일 점령 마킹 (SET NX — 확인과 기록을 단일 원자 연산으로 처리해
   * 동시 요청도 하나만 통과). created=false면 오늘(KST) 이미 점령한 관광지.
   * 이후 단계가 실패하면 호출측이 반환된 token으로 clearDailyClaim을 호출해 이번
   * 요청이 만든 키만 CAS 롤백한다 — 자정 근처 최소 TTL(1초) 구간에서 이 요청이
   * 지연 실패하는 사이 자정을 넘겨 같은 키로 다음날 정상 재점령이 이미 성사된
   * 경우, 무조건 DEL이면 그 새 키를 지워버리므로 tryAcquireLock/releaseLock과
   * 같은 토큰 기반 CAS로 막는다.
   */
  async markDailyClaim(
    userId: string,
    spotId: number,
    ttlSeconds: number,
  ): Promise<{ created: boolean; token: string }> {
    const token = randomUUID();
    const created = await this.tryAcquireLock(
      this.dailyClaimKey(userId, spotId),
      ttlSeconds,
      token,
    );
    return { created, token };
  }

  async clearDailyClaim(
    userId: string,
    spotId: number,
    token: string,
  ): Promise<void> {
    await this.releaseLock(this.dailyClaimKey(userId, spotId), token);
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

  async hasPenalty(userId: string): Promise<boolean> {
    const value = await this.client.get(`penalty:${userId}`);
    return value !== null;
  }

  /**
   * 결투 결과 자가신고 합의 (Lua 원자 연산)
   * - 첫 신고: 'waiting'
   * - 두번째 신고가 첫 신고와 같은 승자: 'confirmed' + winnerId
   * - 두번째 신고가 첫 신고와 다른 승자: 'conflict'
   */
  async submitDuelResult(
    duelId: number,
    reporterId: string,
    winnerId: string,
    ttlSeconds: number,
  ): Promise<
    | { status: 'waiting' }
    | { status: 'confirmed'; winnerId: string }
    | { status: 'conflict' }
  > {
    const key = `duel:result:${duelId}`;
    const lua = `
      redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
      redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
      local all = redis.call('HGETALL', KEYS[1])
      local winners = {}
      local count = 0
      for i = 1, #all, 2 do
        count = count + 1
        winners[count] = all[i + 1]
      end
      if count < 2 then
        return {'waiting'}
      end
      if winners[1] == winners[2] then
        return {'confirmed', winners[1]}
      end
      return {'conflict'}
    `;
    const result = (await this.client.eval(
      lua,
      1,
      key,
      reporterId,
      winnerId,
      String(ttlSeconds),
    )) as string[];
    if (result[0] === 'waiting') return { status: 'waiting' };
    if (result[0] === 'confirmed')
      return { status: 'confirmed', winnerId: result[1] };
    return { status: 'conflict' };
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

  /** 큐에 쌓인 알림을 원자적으로(MULTI) 읽고 비운다 — 드레인 도중 새로 들어온 알림을 잃지 않는다 */
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
    return entries.map(
      (raw) => JSON.parse(raw) as { event: string; payload: unknown },
    );
  }
}
