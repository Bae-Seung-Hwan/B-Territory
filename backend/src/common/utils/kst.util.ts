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
 * 지금의 KST 날짜를 'YYYY-MM-DD'로 반환 — 축제 진행 상태를 Postgres date 컬럼과
 * 같은 형식으로 비교하기 위한 기준값. 서버 타임존과 무관하게 KST 하루를 쓴다.
 */
export function kstDateString(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * KST 날짜를 TourAPI 파라미터용 'YYYYMMDD'로 반환.
 * days만큼 이전/이후로 이동한 날짜를 뽑을 수 있다(동기화 시 과거 조회 범위 계산용).
 */
export function kstYyyymmdd(now: Date = new Date(), offsetDays = 0): string {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS + offsetDays * DAY_MS);
  return shifted.toISOString().slice(0, 10).replace(/-/g, '');
}
