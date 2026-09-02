/**
 * 결투 조우 판정 반경(미터) — backend/src/duels/constants.ts의 ENCOUNTER_RADIUS_M과 값이
 * 같아야 한다. encounter:detected 이벤트엔 정확한 거리값이 실려오지 않으므로
 * (realtime.gateway.ts), 알림 문구에는 이 상수를 "약 100m 이내"라는 근사값으로 쓴다.
 */
export const ENCOUNTER_RADIUS_M = 100;

/**
 * 정지 상태에서도 location:update를 다시 보내는 주기(ms).
 *
 * 서버는 이 이벤트가 올 때만 `user:meta:*`를 갱신하고 그 TTL이 120초다
 * (backend RedisService.META_TTL). useLocation은 distanceInterval:10m이라 가만히
 * 있으면 아무것도 보내지 않으므로, 하트비트가 없으면 2분 뒤 서버가 나를 "접속 중"으로
 * 보지 못해 duel:accepted 같은 알림이 실시간 전달 대신 큐로 빠진다. TTL의 절반으로 둔다.
 */
export const LOCATION_HEARTBEAT_MS = 60_000;

/**
 * 배틀 탭 근처 상대 리스트에서 한 항목이 갱신 없이 남아있을 수 있는 최대 시간(ms).
 * 서버는 같은 쌍에 대해 ENCOUNTER_COOLDOWN_TTL(60초, backend/src/duels/constants.ts)
 * 동안 encounter:detected를 재발송하지 않으므로, 상대가 계속 근처에 있어도 갱신
 * 주기는 최대 60초다. 그 2배를 만료 기준으로 둬서 정상적인 재발송 주기를 실제
 * "더 이상 근처에 없음"으로 오판하지 않게 여유를 둔다.
 */
export const BATTLE_ENEMY_STALE_MS = 120_000;

/** 배틀 탭 리스트에서 만료된 항목을 정리하는 주기(ms). */
export const BATTLE_SWEEP_INTERVAL_MS = 15_000;
