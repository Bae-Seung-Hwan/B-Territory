/** Bull 큐 이름 — 보존기간 만료 삭제(purge) 잡을 처리한다. */
export const WITHDRAWAL_ARCHIVE_QUEUE = 'withdrawal-archive';

/**
 * 탈퇴 보관 표의 보존기간 — 개인정보처리방침 제3조 3항이 정한 6개월.
 * `location_usage_logs`의 법정 보존기간과 같은 시계에 맞춰 삭제 시점을 하나로 둔 값이라,
 * 바꾸려면 그 조항부터 고칠 것. Postgres interval 리터럴로 쓰이므로 형식을 유지한다.
 */
export const WITHDRAWAL_RETENTION_INTERVAL = '6 months';
