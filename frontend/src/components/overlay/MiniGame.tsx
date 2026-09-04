import { useCallback, useEffect, useState } from 'react';
import { Modal, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useSocket } from '@/providers/SocketProvider';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import { TapBattle, ReactionGame, QuizGame } from './minigames';
import type { MiniGameSubmit } from './minigames';

/**
 * gameDeadlineAt(서버 시계 기준 마감 epoch ms)을 화면에 보일 초 단위로 바꾼다. 서버는
 * deadlineAt을 조금 지나서 정산하므로(네트워크 지연 여유), 0에 닿아도 실제 판정까지는
 * 약간의 여유가 있다 — 그래도 남은 시간이 화면에 전혀 없던 것보다는 훨씬 낫다(PR #54
 * 리뷰 지적 6번: TapBattle의 "ready" 대기 화면엔 시계가 전혀 없어, 머뭇거리다 마감을
 * 넘기면 이유도 모른 채 기권패 + 30분 결투 금지를 받았다).
 */
function useRemainingSeconds(deadlineAt: number | null): number | null {
  // Date.now()는 렌더 중(함수 바디)이 아니라 effect 안에서만 부른다 — 렌더 함수는
  // 항상 같은 입력에 같은 출력을 내야 하는데, 렌더마다 Date.now()를 직접 읽으면
  // 그 규칙을 어긴다(react-hooks/purity). "지금 시각"은 상태로만 들고 있는다.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (deadlineAt == null) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadlineAt]);
  if (deadlineAt == null || now == null) return null;
  return Math.max(0, Math.ceil((deadlineAt - now) / 1000));
}

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
  const gameDeadlineAt = useOverlayStore((s) => s.gameDeadlineAt);
  const remainingSeconds = useRemainingSeconds(gameDeadlineAt);
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

  // useCallback으로 감싸지 않으면 MiniGame이 리렌더될 때마다(예: game:opponent:submitted로
  // opponentSubmitted가 바뀔 때) 새 함수가 만들어진다. TapBattle의 카운트다운 effect가
  // onSubmit을 의존성으로 잡고 있어서, 그때마다 진행 중이던 1초 setTimeout이 취소되고
  // 다시 시작해 "5초" 라운드가 리렌더 횟수만큼 최대 1초씩 늘어난다(PR #54 리뷰 지적 14번,
  // 탭 수로 겨루는 게임이라 그대로 유불리가 된다).
  const handleSubmit: MiniGameSubmit = useCallback(
    (value) => {
      if (submitted || duelId == null || gameRound == null) return;
      setSubmitted(true);
      socket?.emit('game:submit', { duelId, round: gameRound, value });
    },
    [submitted, duelId, gameRound, socket],
  );

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
      // 이미 낸 뒤에는 상대의 제출 여부가 나에게 재촉할 이유가 안 된다 — 곧 서버가
      // 정산한다. "마저 제출해주세요"는 반대로, 아직 안 낸 사람에게 필요한 문구다.
      return (
        <>
          <ActivityIndicator color={BrandColors.accent} />
          <Text style={styles.statusText}>{t('overlay.miniGame.waitingOpponent')}</Text>
        </>
      );
    }

    return (
      <>
        {/* 상대가 먼저 냈는데 나는 아직인 상황에서만 재촉이 의미가 있다 — 예전엔 이 문구가
            submitted 블록 안에 있어 정작 필요한 이 시점(아직 제출 전)에는 절대 뜨지
            않았다(PR #54 리뷰 지적 8번). */}
        {opponentSubmitted && (
          <Text style={styles.nudgeText}>{t('overlay.miniGame.opponentAlreadySubmitted')}</Text>
        )}
        {(() => {
          switch (gameType) {
            case 'TAP':
              return <TapBattle durationSec={gameTap?.durationSec ?? 5} onSubmit={handleSubmit} />;
            case 'REACTION':
              return <ReactionGame goSignal={goSignal} onSubmit={handleSubmit} />;
            case 'QUIZ':
              return gameQuiz ? (
                <QuizGame
                  question={gameQuiz.question}
                  choices={gameQuiz.choices}
                  onSubmit={handleSubmit}
                />
              ) : null;
            default:
              return null;
          }
        })()}
      </>
    );
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
        {!submitted && remainingSeconds != null && (
          <Text style={styles.timeLeft}>
            {t('overlay.miniGame.timeLeft', { seconds: remainingSeconds })}
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
  timeLeft: { fontSize: 13, color: BrandColors.danger, fontWeight: '700', marginTop: -16 },
  nudgeText: { fontSize: 13, color: BrandColors.accent, fontWeight: '600' },
  statusText: { color: '#ccc', fontSize: 15, textAlign: 'center' },
});
