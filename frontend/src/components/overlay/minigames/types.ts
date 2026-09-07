/**
 * 각 미니게임이 판정을 내리지 않는다(PR #46, 서버 판정) — 게임을 진행해 무엇을 골랐는지만
 * onSubmit으로 알린다. 게임마다 필요한 값이 달라(TAP=탭수, QUIZ=선택지 index, REACTION=없음)
 * 공통 props 인터페이스를 억지로 유지하지 않고 각 컴포넌트가 자기 props를 따로 정의한다.
 */
export type MiniGameSubmit = (value?: number) => void;
