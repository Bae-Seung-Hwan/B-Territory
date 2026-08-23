/**
 * PR #34(`feature/Bae/team-chat`, 아직 develop 미merge)의 `/chat` 네임스페이스 계약을
 * 그대로 옮겨온 타입. 백엔드 코드를 import하지 않는 이유는 그 브랜치가 이 저장소에
 * 아직 없기 때문 — merge된 뒤에도 이 타입은 실제 DTO/게이트웨이 payload와 동일해야 한다.
 */

/** chat:message emit 시 보내는 페이로드. */
export interface ChatMessageOutgoing {
  text: string;
}

/** chat:message 수신 페이로드 — 발신자 본인에게는 릴레이되지 않는다(낙관적 UI로 자체 표시). */
export interface ChatMessageIncoming {
  userId: string;
  nickname: string;
  team: string;
  text: string;
  at: string;
}
