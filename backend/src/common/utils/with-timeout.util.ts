/**
 * 프로미스가 ms 안에 끝나지 않으면 거부한다.
 *
 * Redis 도달 불가 같은 상황에서 명령이 재시도 소진까지(실측 12~24초) 매달리는 것을 끊는 데
 * 쓴다. 타임아웃이 이겨도 원본 프로미스의 지연 실패는 Promise.race 내부 핸들러가 처리하므로
 * unhandledRejection이 없다. 다만 원본을 취소하지는 못하므로, 호출부는 버려진 작업이 뒤늦게
 * 끝나도 안전한 경로(캐시 적재 같은 best-effort)에만 써야 한다.
 */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms).unref();
    }),
  ]);
}
