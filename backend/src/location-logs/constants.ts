/** Bull 큐 이름 — 기록 적재(record)와 보존기간 만료 삭제(purge) 잡을 함께 처리한다. */
export const LOCATION_LOG_QUEUE = 'location-log';

/**
 * 취득경로 — 이용자 단말기의 GPS/네트워크 측위로 직접 수집한다.
 * 외부 위치정보사업자로부터 제공받는 경로가 생기면 해당 사업자 식별값을 새 상수로 추가한다.
 */
export const ACQUISITION_PATH_DEVICE_GPS = 'DEVICE_GPS';

/**
 * 제공서비스 식별값. 신고서(위치기반서비스사업 사업계획서)에 아래 대응표를 그대로 기재한다.
 * - SVC-01: 관광지 방문 인증(점령) 서비스
 * - SVC-02: 실시간 이용자 매칭(결투) 서비스
 */
export enum LocationServiceCode {
  SPOT_CLAIM = 'SVC-01',
  DUEL_MATCH = 'SVC-02',
}

/**
 * 보존기간 — 위치정보법 제16조 제2항이 정한 법정 최소치(6개월)에 맞춘다.
 * Postgres interval 리터럴로 쓰이므로 값을 바꿀 때 형식을 유지할 것.
 */
export const RETENTION_INTERVAL = '6 months';
