/**
 * 결투 조우 판정 반경(미터) — backend/src/duels/constants.ts의 ENCOUNTER_RADIUS_M과 값이
 * 같아야 한다. encounter:detected 이벤트엔 정확한 거리값이 실려오지 않으므로
 * (realtime.gateway.ts), 알림 문구에는 이 상수를 "약 100m 이내"라는 근사값으로 쓴다.
 */
export const ENCOUNTER_RADIUS_M = 100;
