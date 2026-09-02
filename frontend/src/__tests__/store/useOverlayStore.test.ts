import { useOverlayStore, isDuelBusy } from '@/store/useOverlayStore';

const initialState = useOverlayStore.getState();

describe('useOverlayStore', () => {
  afterEach(() => {
    useOverlayStore.setState(initialState, true);
  });

  describe('startGameRound', () => {
    it('game:start 데이터로 라운드 상태를 채우고 opponentSubmitted를 리셋한다', () => {
      useOverlayStore.getState().setOpponentSubmitted(true);

      useOverlayStore.getState().startGameRound({
        gameType: 'QUIZ',
        round: 1,
        maxRounds: 2,
        deadlineAt: 12345,
        quiz: { question: { ko: 'Q', en: 'Q' }, choices: [{ ko: 'A', en: 'A' }] },
      });

      const state = useOverlayStore.getState();
      expect(state.gameType).toBe('QUIZ');
      expect(state.gameRound).toBe(1);
      expect(state.gameMaxRounds).toBe(2);
      expect(state.gameDeadlineAt).toBe(12345);
      expect(state.gameQuiz).toEqual({ question: { ko: 'Q', en: 'Q' }, choices: [{ ko: 'A', en: 'A' }] });
      expect(state.gameTap).toBeNull();
      expect(state.opponentSubmitted).toBe(false);
    });
  });

  describe('clearGameRound', () => {
    it('라운드 관련 필드를 전부 비운다(재경기 대기 상태)', () => {
      useOverlayStore.getState().startGameRound({
        gameType: 'TAP',
        round: 1,
        maxRounds: 2,
        deadlineAt: 1,
        tap: { durationSec: 5 },
      });
      useOverlayStore.getState().setOpponentSubmitted(true);

      useOverlayStore.getState().clearGameRound();

      const state = useOverlayStore.getState();
      expect(state.gameType).toBeNull();
      expect(state.gameRound).toBeNull();
      expect(state.gameMaxRounds).toBeNull();
      expect(state.gameDeadlineAt).toBeNull();
      expect(state.gameTap).toBeNull();
      expect(state.opponentSubmitted).toBe(false);
    });
  });

  describe('bumpGoSignal', () => {
    it('호출할 때마다 goSignal이 증가한다', () => {
      const before = useOverlayStore.getState().goSignal;
      useOverlayStore.getState().bumpGoSignal();
      expect(useOverlayStore.getState().goSignal).toBe(before + 1);
    });
  });

  describe('resetDuel', () => {
    it('결투·라운드 상태를 전부 초기화한다', () => {
      const store = useOverlayStore.getState();
      store.setDuelId(1);
      store.setDuelRole('challenger');
      store.setShowMiniGame(true);
      store.startGameRound({ gameType: 'TAP', round: 1, maxRounds: 2, deadlineAt: 1, tap: { durationSec: 5 } });
      store.setOpponentSubmitted(true);

      useOverlayStore.getState().resetDuel();

      const state = useOverlayStore.getState();
      expect(state.duelId).toBeNull();
      expect(state.duelRole).toBeNull();
      expect(state.showMiniGame).toBe(false);
      expect(state.gameType).toBeNull();
      expect(state.gameTap).toBeNull();
      expect(state.opponentSubmitted).toBe(false);
    });

    it('goSignal은 초기화하지 않는다 (단조 증가 카운터일 뿐 절대값에 의미가 없다)', () => {
      useOverlayStore.getState().bumpGoSignal();
      useOverlayStore.getState().bumpGoSignal();
      const before = useOverlayStore.getState().goSignal;

      useOverlayStore.getState().resetDuel();

      expect(useOverlayStore.getState().goSignal).toBe(before);
    });
  });

  describe('isDuelBusy', () => {
    it('아무 오버레이도 없고 duelId도 없으면 false', () => {
      expect(isDuelBusy(useOverlayStore.getState())).toBe(false);
    });

    it('showMiniGame만 true여도 true', () => {
      useOverlayStore.getState().setShowMiniGame(true);
      expect(isDuelBusy(useOverlayStore.getState())).toBe(true);
    });

    it('show* 플래그가 전부 false여도 duelId가 있으면 true (accept~duel:accepted 왕복 구간)', () => {
      useOverlayStore.getState().setDuelId(42);
      expect(isDuelBusy(useOverlayStore.getState())).toBe(true);
    });
  });
});
