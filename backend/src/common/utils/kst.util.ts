const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 다음 KST 자정까지 남은 초 (최소 1) — 일일 점령 제한 키의 TTL 계산용.
 * 게임의 "하루" 기준을 구 집계 크론(KST 고정)과 같은 시계로 통일한다.
 * KST는 DST가 없어 고정 오프셋 계산으로 충분하다.
 */
export function secondsUntilKstMidnight(now: Date = new Date()): number {
  const kstMs = now.getTime() + KST_OFFSET_MS;
  const nextMidnightKstMs = (Math.floor(kstMs / DAY_MS) + 1) * DAY_MS;
  return Math.max(1, Math.ceil((nextMidnightKstMs - kstMs) / 1000));
}
