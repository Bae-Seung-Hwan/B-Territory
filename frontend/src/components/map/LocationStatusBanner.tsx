import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';

interface Props {
  error: string | null;
  errorKind?: 'permission' | 'services' | 'unavailable';
  loading: boolean;
  onRecover: () => Promise<void>;
}

export function LocationStatusBanner({ error, errorKind, loading, onRecover }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!error && !loading) return null;
  const message = failed ? t('map.locationUnavailable') : error
    ? t(errorKind === 'permission' ? 'map.locationPermission' : errorKind === 'services' ? 'map.locationServices' : 'map.locationUnavailable')
    : t('map.locationLoading');
  const recover = async () => {
    setBusy(true);
    setFailed(false);
    try { await onRecover(); } catch { setFailed(true); } finally { setBusy(false); }
  };
  return (
    <View style={[styles.container, { bottom: insets.bottom + 84 }]}>
      <Text style={styles.text} accessibilityLiveRegion="polite">{message}</Text>
      {error && <Pressable accessibilityRole="button" disabled={busy} onPress={recover}>
        <Text style={styles.action}>{t(errorKind === 'permission' ? 'map.locationAllow' : 'map.locationRetry')}</Text>
      </Pressable>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', left: 16, right: 16, padding: 12, gap: 8, borderRadius: 12, backgroundColor: BrandColors.surface, zIndex: 10 },
  text: { color: '#fff', fontSize: 14 },
  action: { color: '#fff', fontSize: 14, fontWeight: '700', paddingVertical: 8 },
});
