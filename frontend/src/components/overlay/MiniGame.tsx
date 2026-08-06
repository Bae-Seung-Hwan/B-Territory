import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';

export function MiniGame() {
  const showMiniGame = useOverlayStore((s) => s.showMiniGame);
  const setShowMiniGame = useOverlayStore((s) => s.setShowMiniGame);
  const setEnemyInfo = useOverlayStore((s) => s.setEnemyInfo);
  const { t } = useTranslation();

  const handleClose = () => {
    setShowMiniGame(false);
    setEnemyInfo(null);
  };

  return (
    <Modal visible={showMiniGame} transparent={false} animationType="slide" statusBarTranslucent>
      <View style={styles.container}>
        <Text style={styles.title}>⚡ {t('overlay.miniGame.title')}</Text>
        <Text style={styles.placeholder}>{t('overlay.miniGame.placeholder')}</Text>
        {/* TODO: 실제 미니게임 컴포넌트로 교체 */}
        <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
          <Text style={styles.closeBtnText}>{t('common.close')}</Text>
        </TouchableOpacity>
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
  },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  placeholder: { color: '#555', fontSize: 14 },
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
