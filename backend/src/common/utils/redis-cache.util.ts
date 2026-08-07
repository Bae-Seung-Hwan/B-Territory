import { Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

// 캐시 접근 상한(ms). Redis 정상 응답은 1ms 미만이라 여유가 크고, 도달 불가일 때 요청이
// maxRetriesPerRequest 소진까지(실측 12~24초) 매달리지 않도록 짧게 끊는다.
const CACHE_TIMEOUT_MS = 500;

/**
 * 프로미스가 ms 안에 끝나지 않으면 거부한다. 타임아웃이 이겨도 원본 프로미스의 지연 실패는
 * Promise.race 내부 핸들러가 처리하므로 unhandledRejection이 없다.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms).unref();
    }),
  ]);
}

/**
 * 캐시 읽기 — 실패를 "미스"로 흡수한다.
 *
 * Redis 미스(연결됨·키 없음)와 Redis 도달 불가는 호출부가 구분할 필요가 없다. 둘 다 원본
 * 소스(DB)로 폴백해야 하고 결과도 같다. 감싸지 않으면 도달 불가일 때 redis.get()이 null이
 * 아니라 MaxRetriesPerRequestError를 던져 폴백 라인에 도달조차 못 하고 조회가 500이 된다.
 *
 * 파싱 실패도 미스로 다룬다 — 키에 깨진 값이나 옛 스키마가 남아 있어도 조회가 죽지 않는다.
 */
export async function readJsonCache<T>(
  redis: RedisService,
  key: string,
  logger: Logger,
): Promise<T | null> {
  try {
    const raw = await withTimeout(redis.get(key), CACHE_TIMEOUT_MS);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch (err) {
    logger.warn(`캐시 조회 실패 — 원본 조회로 폴백 (key=${key})`, err as Error);
    return null;
  }
}

/** 캐시 적재 — best-effort. 실패해도 원본 조회 결과는 그대로 반환된다. */
export async function writeJsonCache(
  redis: RedisService,
  key: string,
  value: unknown,
  ttlSec: number,
  logger: Logger,
): Promise<void> {
  try {
    await withTimeout(
      redis.set(key, JSON.stringify(value), ttlSec),
      CACHE_TIMEOUT_MS,
    );
  } catch (err) {
    logger.warn(`캐시 적재 실패 (조회는 계속) (key=${key})`, err as Error);
  }
}
