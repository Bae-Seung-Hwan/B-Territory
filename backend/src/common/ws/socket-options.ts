/**
 * 두 게이트웨이(/realtime, /chat)가 쓰는 socket.io 서버 옵션.
 *
 * 네임스페이스가 달라도 같은 포트의 socket.io 서버 하나를 공유하고, 그 서버는 먼저
 * 초기화된 게이트웨이의 옵션으로 만들어진다. 어느 쪽이 먼저 뜨든 값이 같도록 양쪽에서
 * 이 상수를 쓴다.
 *
 * 핑을 기본값(pingInterval 25s / pingTimeout 20s)보다 촘촘히 잡는 이유는 결투 무응답
 * 페널티 때문이다. 기본값이면 끊긴 연결이 최대 45초(25+20) 뒤에야 disconnect로 드러나는데
 * 결투 신청은 30초(DUEL_REQUEST_TTL)에 만료된다. 그 사이 socket.connected가 계속 true라
 * 게이트웨이는 죽은 소켓에 duel:requested를 흘려보내고, 초대를 받은 적도 없는 유저가
 * "무응답"으로 점수를 물었다. 10s + 10s면 최악 20초 안에 끊김이 드러나, 만료 시점의
 * 생존 판정을 신뢰할 수 있다.
 *
 * DUEL_REQUEST_TTL을 줄인다면 이 합(20초)도 함께 줄여야 한다 — 감지 지연이 만료보다
 * 길어지는 순간 위 전제가 깨진다.
 */
export const SOCKET_PING_INTERVAL_MS = 10_000;
export const SOCKET_PING_TIMEOUT_MS = 10_000;
