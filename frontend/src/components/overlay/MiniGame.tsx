import { useState } from 'react';
import { Modal, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useSocket } from '@/providers/SocketProvider';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import { TapBattle, ReactionGame, QuizGame } from './minigames';
import type { MiniGameSubmit } from './minigames';

/**
 * 결투 미니게임 조립부. 승패는 전부 서버가 판정한다(PR #46) — 여기서는 gameType에 맞는
 * 게임을 골라 보여주고, 플레이 결과(탭 수/선택지 index/제출 사실)만 game:submit으로 보낸다.
 * 결과 화면은 따로 없다 — 서버 확정(duel:completed/duel:voided)은 SocketProvider가 이미
 * Alert로 안내하고 resetDuel()로 이 모달 자체를 닫는다.
 */
export function MiniGame() {
  const showMiniGame = useOverlayStore((s) => s.showMiniGame);
  const duelId = useOverlayStore((s) => s.duelId);
  const gameType = useOverlayStore((s) => s.gameType);
  const gameRound = useOverlayStore((s) => s.gameRound);
  const gameMaxRounds = useOverlayStore((s) => s.gameMaxRounds);
  const gameTap = useOverlayStore((s) => s.gameTap);
  const gameQuiz = useOverlayStore((s) => s.gameQuiz);
  const goSignal = useOverlayStore((s) => s.goSignal);
  const opponentSubmitted = useOverlayStore((s) => s.opponentSubmitted);
  const socket = useSocket();
  const { t } = useTranslation();

  const [submitted, setSubmitted] = useState(false);
  // 라운드가 바뀔 때마다(재경기 포함) 제출 상태를 새로 시작한다 — effect가 아니라 렌더 중
  // 직접 setState하는, React가 안내하는 "prop이 바뀌면 state를 조정하는" 패턴이다
  // (MessageActionSheet.tsx의 prevTarget과 동일한 이유).
  const [prevGameRound, setPrevGameRound] = useState(gameRound);
  if (gameRound !== prevGameRound) {
    setPrevGameRound(gameRound);
    setSubmitted(false);
  }

  const handleSubmit: MiniGameSubmit = (value) => {
    if (submitted || duelId == null || gameRound == null) return;
    setSubmitted(true);
    socket?.emit('game:submit', { duelId, round: gameRound, value });
  };

  const renderBody = () => {
    if (!gameType) {
      return (
        <>
          <ActivityIndicator color={BrandColors.accent} />
          <Text style={styles.statusText}>{t('overlay.miniGame.preparing')}</Text>
        </>
      );
    }

    if (submitted) {
      return (
        <>
          <ActivityIndicator color={BrandColors.accent} />
          <Text style={styles.statusText}>
            {t(
              opponentSubmitted
                ? 'overlay.miniGame.opponentAlreadySubmitted'
                : 'overlay.miniGame.waitingOpponent',
            )}
          </Text>
        </>
      );
    }

    switch (gameType) {
      case 'TAP':
        return <TapBattle durationSec={gameTap?.durationSec ?? 5} onSubmit={handleSubmit} />;
      case 'REACTION':
        return <ReactionGame goSignal={goSignal} onSubmit={handleSubmit} />;
      case 'QUIZ':
        return gameQuiz ? (
          <QuizGame question={gameQuiz.question} choices={gameQuiz.choices} onSubmit={handleSubmit} />
        ) : null;
      default:
        return null;
    }
  };

  return (
    <Modal visible={showMiniGame} transparent={false} animationType="slide" statusBarTranslucent>
      <View style={styles.container}>
        <Text style={styles.title}>⚡ {t('overlay.miniGame.title')}</Text>
        {gameRound != null && gameMaxRounds != null && (
          <Text style={styles.roundLabel}>
            {t('overlay.miniGame.roundLabel', { round: gameRound, maxRounds: gameMaxRounds })}
          </Text>
        )}
        {renderBody()}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BrandColors.background,
    gap: 24,
    padding: 24,
  },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  roundLabel: { fontSize: 13, color: '#888', marginTop: -16 },
  statusText: { color: '#ccc', fontSize: 15, textAlign: 'center' },
});
