import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';

export function DuelRequest() {
  const showDuelRequest = useOverlayStore((s) => s.showDuelRequest);
  const enemyInfo = useOverlayStore((s) => s.enemyInfo);
  const setShowDuelRequest = useOverlayStore((s) => s.setShowDuelRequest);
  const setShowMiniGame = useOverlayStore((s) => s.setShowMiniGame);
  const { t } = useTranslation();

  const handleAccept = () => {
    setShowDuelRequest(false);
    setShowMiniGame(true);
  };

  return (
    <Modal visible={showDuelRequest} transparent animationType="slide" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>⚔️ {t('overlay.duelRequest.title')}</Text>
          {enemyInfo && (
            <Text style={styles.body}>
              {t('overlay.duelRequest.body', { team: enemyInfo.nationality })}
            </Text>
          )}
          <Text style={styles.hint}>{t('overlay.duelRequest.hint')}</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.btnCancel} onPress={() => setShowDuelRequest(false)}>
              <Text style={styles.btnCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnAccept} onPress={handleAccept}>
              <Text style={styles.btnAcceptText}>{t('overlay.duelRequest.start')}</Text>
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
