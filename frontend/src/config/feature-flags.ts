/**
 * 명예의 전당 "역대 기록"(국가 최장 점령·최다 결투 승리, 개인 최다 방문·미션·결투 승률)은
 * 프론트만 먼저 구현하고, 이를 위한 백엔드(GET /hall-of-fame/records/teams·/records/users)는
 * 아직 없다. 존재하지 않는 엔드포인트에 조회를 시도하지 않도록 이 플래그로 막아둔다.
 *
 * 백엔드가 추가되면 이 값을 true로 바꾸는 것 외에 다른 코드 변경은 필요 없다.
 */
export const HALL_OF_FAME_RECORDS_ENABLED = false;
