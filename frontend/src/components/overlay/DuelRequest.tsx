import { Alert, Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useSocket } from '@/providers/SocketProvider';
import { useTranslation, i18n } from '@/i18n';
import { BrandColors } from '@/constants/theme';

interface DuelAcceptAck {
  status: 'ok' | 'error';
  code?: string;
  message?: string;
}

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
    // MiniGame은 서버의 duel:accepted 확인(SocketProvider) 후에 연다 — 여기서 미리 열면
    // 서버가 거부한 경우(이미 처리된 결투 등)에도 게임이 시작돼버린다. 그 왕복 동안
    // 화면이 비지 않도록 대기 화면을 띄운다(수락 자체의 실패는 exception 핸들러가 정리한다).
    setShowDuelRequest(false);
    setShowDuelPending(true);
    if (duelId == null) return;
    // duel:accept는 성공해도 실패해도 항상 ack로 응답한다 — 다만 미니게임 시작 실패
    // (MINIGAME_START_FAILED)만은 서버가 throw가 아니라 이 ack 반환값으로 알려준다
    // (realtime.gateway.ts). 콜백을 안 넘기면 아무도 이 값을 못 읽어, 뒤이어 서버가
    // 보내는 duel:voided에만 복구를 의존하게 되는데 백엔드 스스로 "그 무효 처리도
    // 실패할 수 있다"고 명시해 뒀다 — 그러면 취소 버튼도 없는 DuelPending에 영영
    // 갇힌다(PR #54 리뷰 지적 3번). .timeout()을 걸어 서버가 어떤 이유로든 응답하지
    // 않아도 최대 5초 뒤 스스로 정리되게 한다.
    socket
      ?.timeout(5000)
      .emit('duel:accept', { duelId }, (err: Error | null, ack?: DuelAcceptAck) => {
        if (!err && (!ack || ack.status === 'ok')) return;
        useOverlayStore.getState().resetDuel();
        // exception 핸들러(SocketProvider)와 같은 폴백 규칙 — i18n-js는 없는 키에 "[missing
        // ...]"을 돌려주므로, 아직 매핑 안 된 코드는 서버 메시지로 대신한다.
        const translated = !err && ack?.code ? i18n.t(`overlay.duelError.${ack.code}`) : '[missing]';
        const message = translated.startsWith('[missing')
          ? (ack?.message ?? i18n.t('overlay.duelError.MINIGAME_START_FAILED'))
          : translated;
        Alert.alert(i18n.t('overlay.duelError.title'), message);
      });
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
