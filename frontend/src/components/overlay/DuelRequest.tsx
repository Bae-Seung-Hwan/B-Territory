import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useOverlayStore } from '@/store/useOverlayStore';

export function DuelRequest() {
  const showDuelRequest = useOverlayStore((s) => s.showDuelRequest);
  const enemyInfo = useOverlayStore((s) => s.enemyInfo);
  const setShowDuelRequest = useOverlayStore((s) => s.setShowDuelRequest);
  const setShowMiniGame = useOverlayStore((s) => s.setShowMiniGame);

  const handleAccept = () => {
    setShowDuelRequest(false);
    setShowMiniGame(true);
  };

  return (
    <Modal visible={showDuelRequest} transparent animationType="slide" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>⚔️ 결투 신청</Text>
          {enemyInfo && (
            <Text style={styles.body}>{enemyInfo.nationality} 팀에게 결투를 신청합니다</Text>
          )}
          <Text style={styles.hint}>미니게임에서 승리하면 해당 구역을 점령합니다</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.btnCancel} onPress={() => setShowDuelRequest(false)}>
              <Text style={styles.btnCancelText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnAccept} onPress={handleAccept}>
              <Text style={styles.btnAcceptText}>결투 시작</Text>
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
    backgroundColor: '#1A1A2E',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 32,
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderColor: '#2A2A3E',
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
    backgroundColor: '#208AEF',
    alignItems: 'center',
  },
  btnAcceptText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
