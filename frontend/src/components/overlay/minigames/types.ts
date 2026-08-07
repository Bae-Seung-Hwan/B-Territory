/** 모든 미니게임 컴포넌트가 구현해야 하는 공통 인터페이스. */
export interface MiniGameProps {
  /** 게임이 끝났을 때 정확히 한 번 호출한다 — 내가 이겼는지 여부만 알려주면 된다. */
  onFinish: (didWin: boolean) => void;
}
