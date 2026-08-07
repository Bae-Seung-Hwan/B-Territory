import type { ComponentType } from 'react';
import { TapBattle } from './TapBattle';
import { ReactionGame } from './ReactionGame';
import { QuizGame } from './QuizGame';
import type { MiniGameProps } from './types';

export type { MiniGameProps };

export const GAMES: ComponentType<MiniGameProps>[] = [TapBattle, ReactionGame, QuizGame];

/**
 * duelId는 백엔드(duels.service.ts#requestDuel)가 발급하는 값이라 양쪽 참가자가 이미
 * 동일하게 갖고 있다(duel:requested/duel:accepted 페이로드). 이 값을 시드로 순수 함수
 * 선택을 하면 서버가 게임 종류를 몰라도, 별도 협상 메시지 없이 두 클라이언트가 항상
 * 같은 미니게임을 보게 된다.
 */
export function pickGame(duelId: number): ComponentType<MiniGameProps> {
  return GAMES[duelId % GAMES.length];
}
