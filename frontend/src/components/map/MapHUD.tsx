import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGameStore, getTopTeam } from '@/store/useGameStore';
import { useTranslation } from '@/i18n';

export function MapHUD() {
  const insets = useSafeAreaInsets();
  const topTeam = useGameStore((s) => getTopTeam(s.teamScores));
  const capitalDistrict = useGameStore((s) => s.capitalDistrict);
  const { t } = useTranslation();

  return (
    <View style={[styles.container, { top: insets.top + 8 }]}>
      <View style={styles.pill}>
        <Text style={styles.label}>{t('map.hud.topTeam')}</Text>
        <Text style={styles.value}>{topTeam ?? '—'}</Text>
      </View>
      <View style={styles.pill}>
        <Text style={styles.label}>{t('map.hud.capitalDistrict')}</Text>
        <Text style={styles.value}>{capitalDistrict ?? '—'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    gap: 8,
    zIndex: 10,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(10,10,15,0.85)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  label: { color: '#888', fontSize: 11 },
  value: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
