import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useSocket } from '@/providers/SocketProvider';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';

/** 상대의 결투 신청을 받은 쪽(수신자)에게만 뜨는 수락/거부 시트. */
export function DuelRequest() {
  const showDuelRequest = useOverlayStore((s) => s.showDuelRequest);
  const duelId = useOverlayStore((s) => s.duelId);
  const challengerNickname = useOverlayStore((s) => s.challengerNickname);
  const setShowDuelRequest = useOverlayStore((s) => s.setShowDuelRequest);
  const setShowDuelPending = useOverlayStore((s) => s.setShowDuelPending);
  const resetDuel = useOverlayStore((s) => s.resetDuel);
  const socket = useSocket();
  const { t } = useTranslation();

  const handleReject = () => {
    if (duelId != null) socket?.emit('duel:reject', { duelId });
    resetDuel();
  };

  const handleAccept = () => {
    if (duelId != null) socket?.emit('duel:accept', { duelId });
    // MiniGame은 서버의 duel:accepted 확인(SocketProvider) 후에 연다 — 여기서 미리 열면
    // 서버가 거부한 경우(이미 처리된 결투 등)에도 게임이 시작돼버린다. 그 왕복 동안
    // 화면이 비지 않도록 대기 화면을 띄운다(실패하면 exception 핸들러가 정리한다).
    setShowDuelRequest(false);
    setShowDuelPending(true);
  };

  return (
    <Modal visible={showDuelRequest} transparent animationType="slide" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>⚔️ {t('overlay.duelRequest.title')}</Text>
          <Text style={styles.body}>
            {t('overlay.duelRequest.body', { nickname: challengerNickname ?? '' })}
          </Text>
          <Text style={styles.hint}>{t('overlay.duelRequest.hint')}</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.btnCancel} onPress={handleReject}>
              <Text style={styles.btnCancelText}>{t('overlay.duelRequest.reject')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnAccept} onPress={handleAccept}>
              <Text style={styles.btnAcceptText}>{t('overlay.duelRequest.accept')}</Text>
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
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: BrandColors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 32,
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderColor: BrandColors.border,
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  body: { fontSize: 15, color: '#ccc' },
  hint: { fontSize: 12, color: '#555', textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16, width: '100%' },
  btnCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
  },
  btnCancelText: { color: '#888', fontWeight: '600' },
  btnAccept: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: BrandColors.accent,
    alignItems: 'center',
  },
  btnAcceptText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
