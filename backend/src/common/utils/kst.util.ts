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

// 시즌 시작: 2026-09-01 00:00 KST. 이전은 pre-season(시즌 0). 3개월(분기) 단위, KST 월 경계 기준.
// 월 1일에 시작하므로 월 단위 판정으로 경계가 정확하다(일/시 성분 불필요).
const SEASON_START_YEAR = 2026;
const SEASON_START_MONTH0 = 8; // 0-based: 9월 = 8
const SEASON_LENGTH_MONTHS = 3;
const SEASON_START_ABS_MONTH = SEASON_START_YEAR * 12 + SEASON_START_MONTH0;

/** now가 속한 KST 연·월을 절대 월 인덱스(year*12 + month0)로 반환. */
function kstAbsMonth(now: Date): number {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return kst.getUTCFullYear() * 12 + kst.getUTCMonth();
}

/** 절대 월 인덱스 → 그 KST 월 1일 00:00에 해당하는 절대 시각(Date). KST=UTC+9, DST 없음. */
function absMonthToInstant(absMonth: number): Date {
  const year = Math.floor(absMonth / 12);
  const month0 = absMonth % 12;
  return new Date(Date.UTC(year, month0, 1, 0, 0, 0) - KST_OFFSET_MS);
}

/**
 * now가 속한 시즌 번호(1-based). 시즌 시작(2026-09-01 KST) 전이면 0(pre-season).
 * 시즌은 KST 월 1일에 시작하므로 월 단위 판정으로 경계가 정확하다.
 */
export function seasonIndexOf(now: Date = new Date()): number {
  const elapsed = kstAbsMonth(now) - SEASON_START_ABS_MONTH;
  if (elapsed < 0) return 0;
  return Math.floor(elapsed / SEASON_LENGTH_MONTHS) + 1;
}

/**
 * 시즌 번호(1-based, >=1)의 절대 시각 구간 [start, end) — start 포함, end 제외.
 * 예: 시즌1 = [2026-09-01, 2026-12-01) KST.
 */
export function seasonRange(seasonIndex: number): { start: Date; end: Date } {
  const startAbs =
    SEASON_START_ABS_MONTH + (seasonIndex - 1) * SEASON_LENGTH_MONTHS;
  return {
    start: absMonthToInstant(startAbs),
    end: absMonthToInstant(startAbs + SEASON_LENGTH_MONTHS),
  };
}
