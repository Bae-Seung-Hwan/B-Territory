import { Modal, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useOverlayStore } from '@/store/useOverlayStore';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';

/**
 * 신청자(내가 결투를 건 쪽)가 상대의 응답을 기다리는 동안 뜨는 화면. 백엔드에
 * duel:cancel 같은 취소 이벤트가 없어(realtime.gateway.ts) 별도 취소 버튼은 두지 않고,
 * 서버의 30초 자동 만료(duel:expired) 또는 상대의 수락/거부에 맡긴다.
 */
export function DuelPending() {
  const showDuelPending = useOverlayStore((s) => s.showDuelPending);
  const enemyInfo = useOverlayStore((s) => s.enemyInfo);
  const { t } = useTranslation();

  return (
    <Modal visible={showDuelPending} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ActivityIndicator size="large" color={BrandColors.accent} />
          <Text style={styles.title}>{t('overlay.duelPending.title')}</Text>
          {enemyInfo && (
            <Text style={styles.body}>
              {t('overlay.duelPending.body', { team: enemyInfo.nationality })}
            </Text>
          )}
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
    width: 280,
    backgroundColor: BrandColors.surface,
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BrandColors.border,
    gap: 14,
  },
  title: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  body: { fontSize: 13, color: '#ccc', textAlign: 'center' },
});
