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

/**
 * 주어진 시각이 속한 KST 주의 시작(월요일 00:00 KST)에 해당하는 절대 시각(Date).
 * 수도 지정 크론(월요일 00:00 KST)과 같은 주 경계를 써서 "이번 주 이미 지정됐는지"를 판정한다.
 * KST는 DST가 없어 고정 오프셋 계산으로 충분하다.
 */
export function startOfKstWeek(now: Date = new Date()): Date {
  const kstMs = now.getTime() + KST_OFFSET_MS;
  // kstMs를 UTC로 해석한 요일 = KST 요일 (0=일 … 6=토). 월요일을 주 시작으로 삼는다.
  const kstDay = new Date(kstMs).getUTCDay();
  const daysSinceMonday = (kstDay + 6) % 7; // Mon=0, Tue=1, …, Sun=6
  const startKstMs =
    Math.floor(kstMs / DAY_MS) * DAY_MS - daysSinceMonday * DAY_MS;
  return new Date(startKstMs - KST_OFFSET_MS);
}
