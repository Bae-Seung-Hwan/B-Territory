/**
 * 백엔드 PR #34(`feature/Bae/team-chat`, `/chat` 네임스페이스 ChatGateway)가 아직
 * develop에 merge되지 않았다. 프론트 구현은 그 계약(chat:message/team:location 페이로드)에
 * 맞춰 미리 끝내두되, 존재하지 않는 서버에 연결을 시도하지 않도록 이 플래그로 막아둔다.
 *
 * PR #34가 merge되면 이 값을 true로 바꾸는 것 외에 다른 코드 변경은 필요 없다.
 */
export const CHAT_ENABLED = false;
