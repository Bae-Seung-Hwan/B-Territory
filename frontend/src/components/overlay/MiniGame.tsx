import { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useSocket } from '@/providers/SocketProvider';
import { useAuth } from '@/hooks/use-auth';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import { pickGame } from './minigames';

export function MiniGame() {
  const showMiniGame = useOverlayStore((s) => s.showMiniGame);
  const duelId = useOverlayStore((s) => s.duelId);
  const enemyInfo = useOverlayStore((s) => s.enemyInfo);
  const resetDuel = useOverlayStore((s) => s.resetDuel);
  const socket = useSocket();
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [result, setResult] = useState<'win' | 'lose' | null>(null);

  const handleClose = () => {
    resetDuel();
    setResult(null);
  };

  const handleFinish = (didWin: boolean) => {
    if (duelId != null && profile && enemyInfo) {
      // 승자 판정은 서버가 두 참가자의 신고가 일치할 때만 확정한다(자가신고 합의,
      // duels.service.ts#submitResult) — 여기서는 내가 관찰한 결과만 emit하면 된다.
      const winnerId = didWin ? profile.id : enemyInfo.userId;
      socket?.emit('duel:result', { duelId, winnerId });
    }
    setResult(didWin ? 'win' : 'lose');
  };

  // pickGame은 GAMES 배열의 고정된 컴포넌트 참조 중 하나를 duelId로 결정적으로 골라올 뿐,
  // 새 컴포넌트를 만들지 않는다 — react-hooks/static-components는 이 패턴을 구분하지 못한다.
  const Game = duelId != null ? pickGame(duelId) : null;

  return (
    <Modal visible={showMiniGame} transparent={false} animationType="slide" statusBarTranslucent>
      <View style={styles.container}>
        {result ? (
          <>
            <Text style={styles.resultTitle}>
              {result === 'win' ? t('overlay.miniGame.win') : t('overlay.miniGame.lose')}
            </Text>
            <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
              <Text style={styles.closeBtnText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.title}>⚡ {t('overlay.miniGame.title')}</Text>
            {
              // eslint-disable-next-line react-hooks/static-components -- Game은 GAMES의 고정 참조, 매 렌더 새로 만들어지지 않음
              Game ? <Game onFinish={handleFinish} /> : null
            }
          </>
        )}
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
  resultTitle: { fontSize: 32, fontWeight: 'bold', color: BrandColors.accent },
  closeBtn: {
    marginTop: 32,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
  closeBtnText: { color: '#888', fontWeight: '600' },
});
