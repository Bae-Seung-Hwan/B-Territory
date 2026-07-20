/** 두 유저 id를 정렬해 순서에 무관한 Redis 키를 만든다 (예: 결투 락, 조우 쿨다운) */
export function sortedPairKey(prefix: string, a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `${prefix}:${x}:${y}`;
}
