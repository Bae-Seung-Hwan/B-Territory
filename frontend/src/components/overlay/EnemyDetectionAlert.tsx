import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useTranslation } from '@/i18n';

export function EnemyDetectionAlert() {
  const showEnemyAlert = useOverlayStore((s) => s.showEnemyAlert);
  const enemyInfo = useOverlayStore((s) => s.enemyInfo);
  const setShowEnemyAlert = useOverlayStore((s) => s.setShowEnemyAlert);
  const setShowDuelRequest = useOverlayStore((s) => s.setShowDuelRequest);
  const { t } = useTranslation();

  const handleDuel = () => {
    setShowEnemyAlert(false);
    setShowDuelRequest(true);
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
            <TouchableOpacity style={styles.btnSecondary} onPress={() => setShowEnemyAlert(false)}>
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
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FF4444',
    gap: 12,
  },
  icon: { fontSize: 40 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#FF4444' },
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
    backgroundColor: '#208AEF',
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '600' },
});
