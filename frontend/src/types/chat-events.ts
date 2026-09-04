/**
 * PR #34(`feature/Bae/team-chat`)의 `/chat` 네임스페이스 계약을 그대로 옮겨온 타입.
 * 백엔드는 이미 develop에 merge돼 있다(PR #50 4차 리뷰 지적 3번 — 예전 주석이
 * "아직 미merge"라고 적어 `use-chat-socket.ts`의 같은 내용 주석과 상충했다). 그래도
 * 복제해 두는 이유는 프론트·백엔드가 별도 패키지라 애초에 백엔드 타입을 import할 수
 * 없기 때문 — 이 타입은 실제 DTO/게이트웨이 payload와 항상 동일해야 한다.
 */

/** chat:message emit 시 보내는 페이로드. */
export interface ChatMessageOutgoing {
  text: string;
}

/**
 * chat:message 수신 페이로드 — 정확히는 **발신 소켓**에게는 릴레이되지 않는다
 * (`chat.gateway.ts`의 `client.to(room)`). 같은 계정이 두 기기에 동시 접속해 있으면
 * 반대 기기는 이 이벤트로 내 메시지를 받아 `mine: false`인 남의 말풍선처럼 표시한다 —
 * v1이 감수하는 알려진 한계다(PR #50 4차 리뷰 지적 3번).
 */
export interface ChatMessageIncoming {
  userId: string;
  nickname: string;
  team: string;
  text: string;
  at: string;
}
