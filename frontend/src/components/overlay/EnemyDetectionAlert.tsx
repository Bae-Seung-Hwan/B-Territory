import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useSocket } from '@/providers/SocketProvider';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';

interface DuelRequestAck {
  status: string;
  duelId?: number;
}

export function EnemyDetectionAlert() {
  const showEnemyAlert = useOverlayStore((s) => s.showEnemyAlert);
  const enemyInfo = useOverlayStore((s) => s.enemyInfo);
  const setShowEnemyAlert = useOverlayStore((s) => s.setShowEnemyAlert);
  const setShowDuelPending = useOverlayStore((s) => s.setShowDuelPending);
  const setDuelId = useOverlayStore((s) => s.setDuelId);
  const setDuelRole = useOverlayStore((s) => s.setDuelRole);
  const socket = useSocket();
  const { t } = useTranslation();

  const handleIgnore = () => {
    setShowEnemyAlert(false);
  };

  const handleDuel = () => {
    if (!enemyInfo || !socket) return;
    socket.emit(
      'duel:request',
      { targetUserId: enemyInfo.userId },
      (ack: DuelRequestAck) => {
        // 서버가 거부(예: 상대가 이미 다른 결투 중)하면 duelId가 안 온다 — 이 경우
        // 대기 화면으로 넘어가지 않고 그대로 알림을 닫는다.
        if (ack.status !== 'ok' || ack.duelId == null) {
          setShowEnemyAlert(false);
          return;
        }
        setDuelId(ack.duelId);
        setDuelRole('challenger');
        setShowEnemyAlert(false);
        setShowDuelPending(true);
      },
    );
  };

  return (
    <Modal visible={showEnemyAlert} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.icon}>⚠️</Text>
          <Text style={styles.title}>{t('overlay.enemyAlert.title')}</Text>
          {enemyInfo && (
            <Text style={styles.body}>
              {t('overlay.enemyAlert.body', {
                team: enemyInfo.nationality,
                distance: Math.round(enemyInfo.distance),
              })}
            </Text>
          )}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.btnSecondary} onPress={handleIgnore}>
              <Text style={styles.btnSecondaryText}>{t('overlay.enemyAlert.ignore')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnPrimary} onPress={handleDuel}>
              <Text style={styles.btnPrimaryText}>{t('overlay.enemyAlert.duel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: 300,
    backgroundColor: BrandColors.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BrandColors.danger,
    gap: 12,
  },
  icon: { fontSize: 40 },
  title: { fontSize: 22, fontWeight: 'bold', color: BrandColors.danger },
  body: { fontSize: 14, color: '#ccc', textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  btnSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
  },
  btnSecondaryText: { color: '#888', fontWeight: '600' },
  btnPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: BrandColors.accent,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '600' },
});
